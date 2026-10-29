const crypto = require('node:crypto');
const db = require('./database');
const {CONFIG} = require('./config');
class HttpError extends Error { constructor(status, msg){ super(msg); this.status = status; } }
const nowISO = () => new Date().toISOString();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function cookieHeader(token, maxAgeSec) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${CONFIG.COOKIE_SECURE ? '; Secure' : ''}`;
}
async function getSession(req) {
  const tok = parseCookies(req).sid; if (!tok) return null;
  const row = await db.prepare('SELECT s.role, s.user_id, s.expires_at, u.name, u.mobile, u.email, u.lang FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(sha(tok));
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}
async function createSession(role, userId, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token_hash, role, user_id, expires_at) VALUES (?,?,?,?)').run(sha(token), role, userId, Date.now() + ttlMs);
  return token;
}
// simple in-memory rate limiter
const hits = new Map();
function limit(key, max, windowMs) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many attempts. Please try again later.');
  arr.push(now); hits.set(key, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const requireUser = s => { if (!s || s.role !== 'user') throw new HttpError(401, 'Please login first.'); return s; };
const requireAdmin = s => { if (!s || s.role !== 'admin') throw new HttpError(403, 'Admin only.'); return s; };

const centerOut = c => ({ id: c.id, name: c.name, nameTa: c.name_ta, district: c.district, person: c.person, phone: c.phone, lat: c.lat, lng: c.lng, franchise: !!c.franchise });
const bookingOut = b => ({ id: b.id, name: b.name, mobile: b.mobile, email: b.email, address: b.address, unit: b.unit, area: b.area, kg: b.kg, containers: b.containers, containerKg: b.container_kg,
  date: b.date, centerId: b.center_id, status: b.status, createdAt: b.created_at, photo: `/api/bookings/${b.id}/photo` });
const BOOKING_COLS = 'id,name,mobile,email,address,unit,area,kg,containers,container_kg,date,center_id,status,created_at,user_id';


module.exports = {HttpError, nowISO, sha, safeEq, str, send, readBody, parseCookies, cookieHeader, getSession, createSession, limit, requireUser, requireAdmin, centerOut, bookingOut, BOOKING_COLS};
