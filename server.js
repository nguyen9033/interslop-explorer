const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const env = { ...process.env };
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  });
}

const PROVIDERS = {
  deepseek: {
    hostname: 'api.deepseek.com',
    path: '/chat/completions',
    key: env.DEEPSEEK_API_KEY,
    model: 'deepseek-v4-flash',
    extra: { thinking: { type: 'disabled' } },
  },
  cerebras: {
    hostname: 'api.cerebras.ai',
    path: '/v1/chat/completions',
    key: env.CEREBRAS_API_KEY,
    model: 'gpt-oss-120b',
    extra: {},
  },
};

const PORT = env.PORT || 3000;

const rateLimit = {};
const RATE_WINDOW = 60000;
const RATE_MAX = 15;
const DAILY_MAX = 500;
let dailyCount = 0;
let dailyReset = Date.now() + 86400000;

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
}

function checkRate(ip) {
  const now = Date.now();
  if (now > dailyReset) { dailyCount = 0; dailyReset = now + 86400000; }
  if (dailyCount >= DAILY_MAX) return false;
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < RATE_WINDOW);
  if (rateLimit[ip].length >= RATE_MAX) return false;
  rateLimit[ip].push(now);
  dailyCount++;
  return true;
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    const ip = getIP(req);
    if (!checkRate(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again in a minute.' }));
      return;
    }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400);
        res.end('Bad JSON');
        return;
      }

      const provider = PROVIDERS[parsed.provider] || PROVIDERS.deepseek;

      const payload = JSON.stringify({
        model: provider.model,
        messages: parsed.messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
        ...provider.extra,
      });

      const apiReq = https.request({
        hostname: provider.hostname,
        path: provider.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.key}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      }, apiRes => {
        res.writeHead(apiRes.statusCode, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        apiRes.pipe(res);
      });

      apiReq.on('error', err => {
        console.error('API error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });

      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Interdimensional Explorer → http://localhost:${PORT}`));
