const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

// ── Codex Pets API bases (proxied server-side to avoid CORS)
const CODEX_API    = 'https://pets.ydb-qdrant.tech'; // ~161 pets
const OPENPETS_API = 'https://openpets.sh';            // ~5,877 pets (Codex Pet Share mirror)

const MIME_TYPES = {
  '.html' : 'text/html; charset=utf-8',
  '.js'   : 'text/javascript; charset=utf-8',
  '.css'  : 'text/css; charset=utf-8',
  '.json' : 'application/json; charset=utf-8',
  '.png'  : 'image/png',
  '.jpg'  : 'image/jpeg',
  '.jpeg' : 'image/jpeg',
  '.svg'  : 'image/svg+xml',
  '.webp' : 'image/webp',
  '.wav'  : 'audio/wav',
  '.ico'  : 'image/x-icon'
};

// ── Server-side proxy helper: fetch from upstream and pipe back
function proxyRequest(req, res, upstreamUrl) {
  const parsed  = new URL(upstreamUrl);
  const options = {
    hostname : parsed.hostname,
    port     : parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path     : parsed.pathname + parsed.search,
    method   : 'GET',
    headers  : {
      'User-Agent' : 'Komorebi-PWA-Proxy/2.0',
      'Accept'     : '*/*',
    }
  };

  const proto    = parsed.protocol === 'http:' ? http : https;
  const proxyReq = proto.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.writeHead(proxyRes.statusCode, {
      'Content-Type'                : ct,
      'Access-Control-Allow-Origin' : '*',
      'Cache-Control'               : 'public, max-age=300',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[proxy] Error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: err.message }));
  });

  proxyReq.end();
}

const server = http.createServer((req, res) => {
  // ── CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end();
    return;
  }

  const safeUrl = req.url.split('?')[0].split('#')[0];

  // ── /codex-proxy/* → proxy to pets.ydb-qdrant.tech  (~161 pets)
  if (safeUrl.startsWith('/codex-proxy/')) {
    const upstreamPath = safeUrl.replace('/codex-proxy', '');
    const upstreamUrl  = CODEX_API + upstreamPath;
    console.log('[codex-proxy]', upstreamUrl);
    proxyRequest(req, res, upstreamUrl);
    return;
  }

  // ── /openpets-proxy/* → proxy to openpets.sh  (~5,877 pets)
  if (safeUrl.startsWith('/openpets-proxy/')) {
    const upstreamPath = safeUrl.replace('/openpets-proxy', '');
    const upstreamUrl  = OPENPETS_API + upstreamPath;
    console.log('[openpets-proxy]', upstreamUrl);
    proxyRequest(req, res, upstreamUrl);
    return;
  }

  // ── Static file serving
  let filePath = safeUrl === '/' ? '/index.html' : safeUrl;
  filePath = path.join(PUBLIC_DIR, filePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }

    const ext         = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type'                : contentType,
      'Access-Control-Allow-Origin' : '*',
      'Cache-Control'               : 'no-cache, no-store, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================`);
  console.log(`🚀 Loop PWA Dev Server is running!`);
  console.log(`👉 Local:   http://localhost:${PORT}`);
  console.log(`👉 Network: http://127.0.0.1:${PORT}`);
  console.log(`👉 Proxy:   /codex-proxy/* → ${CODEX_API}`);
  console.log(`========================================\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const nextPort = PORT + 1;
    console.log(`Port ${PORT} in use, trying ${nextPort}...`);
    server.listen(nextPort, '0.0.0.0');
  } else {
    console.error('Server error:', err);
  }
});
