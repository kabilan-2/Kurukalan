const http = require('node:http');
const {CONFIG} = require('./config');
const db = require('./database');
async function start(){
  await db.ready;
const routes = require('./routes');
const serveStatic = require('./static');
const {HttpError, send, readBody, getSession} = require('./helpers');
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://services.arcgisonline.com https://cdnjs.cloudflare.com; connect-src 'self'; frame-ancestors 'none'";

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CSP);
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || '?';
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, url.pathname);
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname); if (!m) continue;
      let body = {};
      if (req.method !== 'GET') {
        // JSON-only requests: blocks cross-site form posts (CSRF) together with SameSite cookies
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
        body = await readBody(req);
      }
      const out = await r.fn({ req, res, ip, body, params: m.groups || {}, session: await getSession(req) });
      if (res.writableEnded || res.headersSent) return;
      if (out && out.data !== undefined) return send(res, out.status || 200, out.data, out.headers);
      return send(res, 200, out);
    }
    throw new HttpError(404, 'API route not found');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e); send(res, 500, { error: 'Server error' });
  }
});
server.on('error',error=>{console.error(error.code === 'EADDRINUSE' ? 'Port '+CONFIG.PORT+' is in use. Close the other server or set a different PORT in .env.' : 'HTTP server could not start: '+error.code);process.exit(1);});
server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`\nKurukalan server running:  http://localhost:${CONFIG.PORT}`);
  console.log(db.kind === 'postgres' ? '   Database: cloud PostgreSQL connected' : `   Database file: ${CONFIG.DB_PATH}`);
  if (!CONFIG.ADMIN_PASS) console.log('   Admin login disabled. Set ADMIN_ID and ADMIN_PASS in .env.\n');
});

}
start().catch(error => { console.error('Backend startup failed. Check database configuration. Code: ' + (error.code || error.name)); process.exit(1); });
