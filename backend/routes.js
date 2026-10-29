const db = require('./database');
const {CONFIG, UNITS, SQFT_TO_HA} = require('./config');
const {HttpError, nowISO, sha, safeEq, str, send, readBody, parseCookies, cookieHeader, getSession, createSession, limit, requireUser, requireAdmin, centerOut, bookingOut, BOOKING_COLS} = require('./helpers');
const otp = require('./services/otp');
const supportContact = require('./support-config');
const {notifySupport} = require('./services/support');
const routes = [];
const route = (method, p, fn) => routes.push({ method, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/me', async ({ session }) => session ? { role: session.role, name: session.name || 'Admin', mobile: session.mobile || null, email: session.email || null, lang: session.lang || 'en' } : { role: null });

const emailAddress = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  return email;
};
route('POST', '/api/auth/otp/send', async ({body, ip}) => {
  const email = emailAddress(body.email);
  limit('email-ip:' + ip, 10, 3600e3); limit('email-address:' + email, 1, 60e3);
  await otp.send(email);
  return {ok:true};
});
function authenticateUser(signup) {
  return async ({ body, ip }) => {
    limit('login:' + ip, 30, 15 * 60e3);
    const name = str(body.name, 80), email = emailAddress(body.email);
    const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
    if (signup && !name) throw new HttpError(400, 'Name is required.');
    if (signup && !/^[6-9]\d{9}$/.test(mobile)) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number.');
    await otp.check(email, str(body.code, 10));
    let u = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (signup && u) throw new HttpError(409, 'This email is already registered. Choose Sign In and request a new code.');
    if (!signup && !u) throw new HttpError(404, 'No account found. Choose New User / Sign Up and request a new code.');
    const other = signup && await db.prepare('SELECT id FROM users WHERE mobile=? AND (email IS NULL OR email<>?)').get(mobile,email);
    if (other) throw new HttpError(409, 'This mobile number belongs to another account. Contact the administrator.');
    const t = nowISO();
    if (signup) await db.prepare('INSERT INTO users (name,mobile,email,created_at,last_login) VALUES (?,?,?,?,?)').run(name,mobile,email,t,t);
    else await db.prepare('UPDATE users SET last_login=? WHERE id=?').run(t,u.id);
    u = await db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const ttl = CONFIG.USER_SESSION_DAYS * 86400e3;
    const token = await createSession('user',u.id,ttl);
    return {status:200,headers:{'Set-Cookie':cookieHeader(token,ttl/1000)},data:{role:'user',name:u.name,mobile:u.mobile,email:u.email,lang:u.lang}};
  };
}
route('POST', '/api/login/user', authenticateUser(false));
route('POST', '/api/signup/user', authenticateUser(true));

route('POST', '/api/login/admin', async ({ body, ip }) => {
  limit('admin:' + ip, 8, 15 * 60e3);
  if (!CONFIG.ADMIN_PASS) throw new HttpError(503, 'Administrator credentials have not been configured.');
  const okId = safeEq(str(body.id, 100), CONFIG.ADMIN_ID), okPw = safeEq(typeof body.password === 'string' ? body.password : '', CONFIG.ADMIN_PASS);
  if (!(okId && okPw)) throw new HttpError(401, 'Wrong Admin ID or password.');
  const ttl = CONFIG.ADMIN_SESSION_HOURS * 3600e3;
  const token = await createSession('admin', null, ttl);
  return { status: 200, headers: { 'Set-Cookie': cookieHeader(token, ttl / 1000) }, data: { role: 'admin', name: 'Admin' } };
});

route('POST', '/api/logout', async ({ req }) => {
  const tok = parseCookies(req).sid; if (tok) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(tok));
  return { status: 200, headers: { 'Set-Cookie': cookieHeader('', 0) }, data: { ok: true } };
});

route('PATCH', '/api/me', async ({ session, body }) => {
  requireUser(session);
  if (body.lang === 'en' || body.lang === 'ta') await db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(body.lang, session.user_id);
  return { ok: true };
});

/* centers */
route('GET', '/api/centers', async () => (await db.prepare('SELECT * FROM centers ORDER BY id').all()).map(centerOut));
route('POST', '/api/centers', async ({ session, body }) => {
  requireAdmin(session);
  const c = { name: str(body.name, 120), name_ta: str(body.nameTa, 120), district: str(body.district, 80), person: str(body.person, 80), phone: str(body.phone, 30) };
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!c.name || !c.district || !c.person || !c.phone) throw new HttpError(400, 'Please fill all center details.');
  if (!(lat >= 5 && lat <= 15 && lng >= 74 && lng <= 82)) throw new HttpError(400, 'Location must be inside Tamil Nadu.');
  const r = await db.prepare('INSERT INTO centers (name,name_ta,district,person,phone,lat,lng,franchise) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.name, c.name_ta, c.district, c.person, c.phone, lat, lng, body.franchise ? 1 : 0);
  return centerOut(await db.prepare('SELECT * FROM centers WHERE id = ?').get(Number(r.lastInsertRowid)));
});
route('PATCH', '/api/centers/:id', async ({ session, body, params }) => {
  requireAdmin(session);
  if (typeof body.franchise !== 'boolean') throw new HttpError(400, 'Franchise status must be true or false.');
  const r = await db.prepare('UPDATE centers SET franchise = ? WHERE id = ?').run(body.franchise ? 1 : 0, +params.id);
  if (!r.changes) throw new HttpError(404, 'Center not found.');
  return { ok: true };
});
route('DELETE', '/api/centers/:id', async ({ session, params }) => {
  requireAdmin(session);
  await db.prepare('DELETE FROM centers WHERE id = ?').run(+params.id);
  return { ok: true };
});

/* bookings */
route('POST', '/api/bookings', async ({ session, body }) => {
  requireUser(session);
  const name = session.name, address = str(body.address, 300), mobile = session.mobile || '', email = session.email;
  const unit = str(body.unit, 20), area = Number(body.area), date = str(body.date, 10);
  if (!address) throw new HttpError(400, 'Address is required.');
  if (!name || !mobile) throw new HttpError(400, 'Please sign in again with your name and mobile number.');
  if (!email) throw new HttpError(401, 'Please sign in with email verification.');
  if (!(unit in UNITS)) throw new HttpError(400, 'Invalid land unit.');
  if (!(area > 0 && area < 1e6)) throw new HttpError(400, 'Enter a land area greater than 0.');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || date < today) throw new HttpError(400, 'Choose a valid date (today or later).');
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(typeof body.photo === 'string' ? body.photo : '');
  if (!m) throw new HttpError(400, 'Please upload a photo (JPG, PNG or WebP).');
  const photo = Buffer.from(m[2], 'base64');
  if (!photo.length || photo.length > CONFIG.MAX_PHOTO_BYTES) throw new HttpError(400, 'Photo is too large (max 3 MB).');
  const centerId = null; // Center selection is handled outside the farmer booking form.
  // Estimate harvest on the server; validate and save the requested container choices.
  const kg = Math.round(area * UNITS[unit] * SQFT_TO_HA * CONFIG.YIELD_KG_PER_HECTARE);
  const containerKg = body.containerKg === undefined ? (kg <= 2500 ? 2500 : 5000) : body.containerKg;
  if (![2500,5000].includes(containerKg)) throw new HttpError(400, 'Choose 50 sacks (2500 kg) or 100 sacks (5000 kg).');
  const containers = body.containers === undefined ? Math.max(1, Math.ceil(kg / containerKg)) : body.containers;
  if (!Number.isSafeInteger(containers) || containers < 1 || containers > 1e6) throw new HttpError(400, 'Container count must be a whole number between 1 and 1,000,000.');
  const r = await db.prepare('INSERT INTO bookings (user_id,name,mobile,email,address,photo,photo_mime,unit,area,kg,containers,container_kg,date,center_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(session.user_id, name, mobile, email, address, photo, m[1], unit, area, kg, containers, containerKg, date, centerId, 'Pending', nowISO());
  return bookingOut(await db.prepare(`SELECT ${BOOKING_COLS} FROM bookings WHERE id = ?`).get(Number(r.lastInsertRowid)));
});
route('GET', '/api/bookings', async ({ session }) => {
  if (!session) throw new HttpError(401, 'Please login first.');
  const rows = session.role === 'admin'
    ? await db.prepare(`SELECT ${BOOKING_COLS} FROM bookings ORDER BY id`).all()
    : await db.prepare(`SELECT ${BOOKING_COLS} FROM bookings WHERE user_id = ? ORDER BY id`).all(session.user_id);
  return rows.map(bookingOut);
});
route('PATCH', '/api/bookings/:id', async ({ session, body, params }) => {
  requireAdmin(session);
  if (!['Pending', 'Confirmed', 'Rejected'].includes(body.status)) throw new HttpError(400, 'Invalid status.');
  const r = await db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(body.status, +params.id);
  if (!r.changes) throw new HttpError(404, 'Booking not found.');
  return { ok: true };
});
route('GET', '/api/bookings/:id/photo', async ({ session, params, res }) => {
  if (!session) throw new HttpError(401, 'Please login first.');
  const b = await db.prepare('SELECT user_id, photo, photo_mime FROM bookings WHERE id = ?').get(+params.id);
  if (!b || (session.role !== 'admin' && b.user_id !== session.user_id)) throw new HttpError(404, 'Not found.');
  res.writeHead(200, { 'Content-Type': b.photo_mime, 'Cache-Control': 'private, max-age=3600', 'Content-Length': b.photo.length });
  res.end(Buffer.from(b.photo));
  return undefined;
});

/* support messages */
route('GET', '/api/support/contact', async () => supportContact);
route('POST', '/api/messages', async ({ body, ip }) => {
  limit('msg:' + ip, 5, 10 * 60e3);
  const name = str(body.name, 80), mobile = str(body.mobile, 10), text = str(body.text, 2000);
  if (!name || !text || !/^[6-9]\d{9}$/.test(mobile)) throw new HttpError(400, 'Please fill name, a valid mobile number and message.');
  const saved = await db.prepare('INSERT INTO messages (name,mobile,text,created_at) VALUES (?,?,?,?)').run(name, mobile, text, nowISO());
  const emailDelivery = await notifySupport({id:Number(saved.lastInsertRowid),name,mobile,text});
  await db.prepare('UPDATE messages SET email_delivery=? WHERE id=?').run(emailDelivery,Number(saved.lastInsertRowid));
  return { ok: true, emailDelivery };
});
route('GET', '/api/messages', async ({ session }) => {
  requireAdmin(session);
  return await db.prepare('SELECT id,name,mobile,text,email_delivery AS emailDelivery,created_at AS createdAt FROM messages ORDER BY id').all();
});

/* users (admin) */
route('GET', '/api/users', async ({ session }) => {
  requireAdmin(session);
  return await db.prepare(`SELECT u.id,u.name,u.mobile,u.email,u.lang,u.created_at AS createdAt,u.last_login AS lastLogin,
    COUNT(b.id) AS bookings FROM users u LEFT JOIN bookings b ON b.user_id=u.id
    GROUP BY u.id,u.name,u.mobile,u.email,u.lang,u.created_at,u.last_login ORDER BY u.id`).all();
});


route('GET', '/api/admin/summary', async ({session}) => {
  requireAdmin(session);
  const counts = {};
  for (const table of ['users','bookings','centers','messages']) counts[table] = (await db.prepare('SELECT COUNT(*) AS count FROM ' + table).get()).count;
  return counts;
});

route('GET','/api/admin/system', async ({session}) => {
  requireAdmin(session);
  await db.prepare('SELECT 1 AS ok').get();
  return {database:{type:db.kind,connected:true},email:{provider:'Brevo',configured:!!(process.env.BREVO_API_KEY && process.env.EMAIL_FROM)},supportEmailConfigured:!!supportContact.email};
});
module.exports = routes;
