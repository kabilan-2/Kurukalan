const db = require('./database');
const {CONFIG, UNITS, SQFT_TO_HA} = require('./config');
const {
  HttpError, nowISO, sha, safeEq, str,
  parseCookies, cookieHeader, createSession,
  limit, requireUser, requireAdmin,
  centerOut, bookingOut, BOOKING_COLS
} = require('./helpers');

const otp = require('./services/otp');
const supportContact = require('./support-config');
const {notifySupport} = require('./services/support');

const routes = [];

const route = (method, path, fn) => {
  routes.push({
    method,
    re: new RegExp(
      '^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'
    ),
    fn
  });
};

/* Current session */

route('GET', '/api/me', async ({session}) => {
  return session
    ? {
        role: session.role,
        name: session.name || 'Admin',
        mobile: session.mobile || null,
        email: session.email || null,
        lang: session.lang || 'en'
      }
    : {role: null};
});

/* Email authentication */

const emailAddress = value => {
  const email = typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, 'Enter a valid email address.');
  }

  return email;
};

route('POST', '/api/auth/otp/send', async ({body, ip}) => {
  const email = emailAddress(body.email);

  limit('email-ip:' + ip, 10, 3600e3);
  limit('email-address:' + email, 1, 60e3);

  await otp.send(email);

  return {ok: true};
});

function authenticateUser(signup) {
  return async ({body, ip}) => {
    limit('login:' + ip, 30, 15 * 60e3);

    const name = str(body.name, 80);
    const email = emailAddress(body.email);
    const mobile = typeof body.mobile === 'string'
      ? body.mobile.trim()
      : '';

    if (signup && !name) {
      throw new HttpError(400, 'Name is required.');
    }

    if (signup && !/^[6-9]\d{9}$/.test(mobile)) {
      throw new HttpError(
        400,
        'Enter a valid 10-digit Indian mobile number.'
      );
    }

    await otp.check(email, str(body.code, 10));

    let user = await db.prepare(
      'SELECT * FROM users WHERE email = ?'
    ).get(email);

    if (signup && user) {
      throw new HttpError(
        409,
        'This email is already registered. Choose Sign In and request a new code.'
      );
    }

    if (!signup && !user) {
      throw new HttpError(
        404,
        'No account found. Choose New User / Sign Up and request a new code.'
      );
    }

    const other = signup && await db.prepare(
      'SELECT id FROM users WHERE mobile=? AND (email IS NULL OR email<>?)'
    ).get(mobile, email);

    if (other) {
      throw new HttpError(
        409,
        'This mobile number belongs to another account. Contact the administrator.'
      );
    }

    const timestamp = nowISO();

    if (signup) {
      await db.prepare(
        'INSERT INTO users (name,mobile,email,created_at,last_login) VALUES (?,?,?,?,?)'
      ).run(name, mobile, email, timestamp, timestamp);
    } else {
      await db.prepare(
        'UPDATE users SET last_login=? WHERE id=?'
      ).run(timestamp, user.id);
    }

    user = await db.prepare(
      'SELECT * FROM users WHERE email=?'
    ).get(email);

    const ttl = CONFIG.USER_SESSION_DAYS * 86400e3;
    const token = await createSession('user', user.id, ttl);

    return {
      status: 200,
      headers: {
        'Set-Cookie': cookieHeader(token, ttl / 1000)
      },
      data: {
        role: 'user',
        name: user.name,
        mobile: user.mobile,
        email: user.email,
        lang: user.lang
      }
    };
  };
}

route('POST', '/api/login/user', authenticateUser(false));
route('POST', '/api/signup/user', authenticateUser(true));

/* Admin authentication */

route('POST', '/api/login/admin', async ({body, ip}) => {
  limit('admin:' + ip, 8, 15 * 60e3);

  if (!CONFIG.ADMIN_PASS) {
    throw new HttpError(
      503,
      'Administrator credentials have not been configured.'
    );
  }

  const validId = safeEq(str(body.id, 100), CONFIG.ADMIN_ID);
  const validPassword = safeEq(
    typeof body.password === 'string' ? body.password : '',
    CONFIG.ADMIN_PASS
  );

  if (!(validId && validPassword)) {
    throw new HttpError(401, 'Wrong Admin ID or password.');
  }

  const ttl = CONFIG.ADMIN_SESSION_HOURS * 3600e3;
  const token = await createSession('admin', null, ttl);

  return {
    status: 200,
    headers: {
      'Set-Cookie': cookieHeader(token, ttl / 1000)
    },
    data: {
      role: 'admin',
      name: 'Admin'
    }
  };
});

route('POST', '/api/logout', async ({req}) => {
  const token = parseCookies(req).sid;

  if (token) {
    await db.prepare(
      'DELETE FROM sessions WHERE token_hash = ?'
    ).run(sha(token));
  }

  return {
    status: 200,
    headers: {
      'Set-Cookie': cookieHeader('', 0)
    },
    data: {ok: true}
  };
});

route('PATCH', '/api/me', async ({session, body}) => {
  requireUser(session);

  if (body.lang === 'en' || body.lang === 'ta') {
    await db.prepare(
      'UPDATE users SET lang = ? WHERE id = ?'
    ).run(body.lang, session.user_id);
  }

  return {ok: true};
});

/* Centers */

route('GET', '/api/centers', async () => {
  const centers = await db.prepare(
    'SELECT * FROM centers ORDER BY id'
  ).all();

  return centers.map(centerOut);
});

route('POST', '/api/centers', async ({session, body}) => {
  requireAdmin(session);

  const center = {
    name: str(body.name, 120),
    nameTa: str(body.nameTa, 120),
    district: str(body.district, 80),
    person: str(body.person, 80),
    phone: str(body.phone, 30)
  };

  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (
    !center.name ||
    !center.district ||
    !center.person ||
    !center.phone
  ) {
    throw new HttpError(400, 'Please fill all center details.');
  }

  if (!(lat >= 5 && lat <= 15 && lng >= 74 && lng <= 82)) {
    throw new HttpError(400, 'Location must be inside Tamil Nadu.');
  }

  const result = await db.prepare(
    'INSERT INTO centers (name,name_ta,district,person,phone,lat,lng,franchise) VALUES (?,?,?,?,?,?,?,?)'
  ).run(
    center.name,
    center.nameTa,
    center.district,
    center.person,
    center.phone,
    lat,
    lng,
    body.franchise ? 1 : 0
  );

  return centerOut(
    await db.prepare(
      'SELECT * FROM centers WHERE id = ?'
    ).get(Number(result.lastInsertRowid))
  );
});

route('PATCH', '/api/centers/:id', async ({session, body, params}) => {
  requireAdmin(session);

  if (typeof body.franchise !== 'boolean') {
    throw new HttpError(
      400,
      'Franchise status must be true or false.'
    );
  }

  const result = await db.prepare(
    'UPDATE centers SET franchise = ? WHERE id = ?'
  ).run(body.franchise ? 1 : 0, +params.id);

  if (!result.changes) {
    throw new HttpError(404, 'Center not found.');
  }

  return {ok: true};
});

route('DELETE', '/api/centers/:id', async ({session, params}) => {
  requireAdmin(session);

  await db.prepare(
    'DELETE FROM centers WHERE id = ?'
  ).run(+params.id);

  return {ok: true};
});

/* Create booking */

route('POST', '/api/bookings', async ({session, body}) => {
  requireUser(session);

  const name = session.name;
  const mobile = session.mobile || '';
  const email = session.email;
  const address = str(body.address, 300);
  const unit = str(body.unit, 20);
  const area = Number(body.area);
  const date = str(body.date, 10);

  if (!address) {
    throw new HttpError(400, 'Address is required.');
  }

  if (!name || !mobile) {
    throw new HttpError(
      400,
      'Please sign in again with your name and mobile number.'
    );
  }

  if (!email) {
    throw new HttpError(
      401,
      'Please sign in with email verification.'
    );
  }

  if (!Object.hasOwn(UNITS, unit)) {
    throw new HttpError(400, 'Invalid land unit.');
  }

  if (!(area > 0 && area < 1e6)) {
    throw new HttpError(
      400,
      'Enter a land area greater than 0 and below 1,000,000.'
    );
  }

  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata'
  });

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date < today
  ) {
    throw new HttpError(
      400,
      'Choose a valid date (today or later).'
    );
  }

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
    typeof body.photo === 'string' ? body.photo : ''
  );

  if (!match) {
    throw new HttpError(
      400,
      'Please upload a photo (JPG, PNG or WebP).'
    );
  }

  const photo = Buffer.from(match[2], 'base64');

  if (!photo.length || photo.length > CONFIG.MAX_PHOTO_BYTES) {
    throw new HttpError(400, 'Photo is too large (max 3 MB).');
  }

  const kg = Math.round(
    area * UNITS[unit] * SQFT_TO_HA * CONFIG.YIELD_KG_PER_HECTARE
  );

  const containerKg = body.containerKg === undefined
    ? (kg <= 2500 ? 2500 : 5000)
    : body.containerKg;

  if (![2500, 5000].includes(containerKg)) {
    throw new HttpError(
      400,
      'Choose 50 sacks (2500 kg) or 100 sacks (5000 kg).'
    );
  }

  const containers = body.containers === undefined
    ? Math.max(1, Math.ceil(kg / containerKg))
    : body.containers;

  if (
    !Number.isSafeInteger(containers) ||
    containers < 1 ||
    containers > 1e6
  ) {
    throw new HttpError(
      400,
      'Container count must be a whole number between 1 and 1,000,000.'
    );
  }

  const result = await db.prepare(
    `INSERT INTO bookings
     (user_id,name,mobile,email,address,photo,photo_mime,
      unit,area,kg,containers,container_kg,date,center_id,status,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    session.user_id,
    name,
    mobile,
    email,
    address,
    photo,
    match[1],
    unit,
    area,
    kg,
    containers,
    containerKg,
    date,
    null,
    'Pending',
    nowISO()
  );

  return bookingOut(
    await db.prepare(
      `SELECT ${BOOKING_COLS} FROM bookings WHERE id = ?`
    ).get(Number(result.lastInsertRowid))
  );
});

/* List bookings */

route('GET', '/api/bookings', async ({session}) => {
  if (!session) {
    throw new HttpError(401, 'Please login first.');
  }

  const rows = session.role === 'admin'
    ? await db.prepare(
        `SELECT ${BOOKING_COLS} FROM bookings ORDER BY id`
      ).all()
    : await db.prepare(
        `SELECT ${BOOKING_COLS}
         FROM bookings WHERE user_id = ? ORDER BY id`
      ).all(session.user_id);

  return rows.map(bookingOut);
});

/* Update booking — admin only */

route('PATCH', '/api/bookings/:id', async ({session, body, params}) => {
  requireAdmin(session);

  const id = Number(params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'Invalid booking ID.');
  }

  const booking = await db.prepare(
    `SELECT address,unit,area,containers,container_kg,date,status
     FROM bookings WHERE id = ?`
  ).get(id);

  if (!booking) {
    throw new HttpError(404, 'Booking not found.');
  }

  const allowed = [
    'address',
    'unit',
    'area',
    'containers',
    'containerKg',
    'date',
    'status'
  ];

  if (
    !Object.keys(body).length ||
    Object.keys(body).some(key => !allowed.includes(key))
  ) {
    throw new HttpError(400, 'Unsupported booking fields.');
  }

  const address = body.address === undefined
    ? booking.address
    : str(body.address, 300);

  const unit = body.unit === undefined
    ? booking.unit
    : body.unit;

  const area = body.area === undefined
    ? booking.area
    : body.area;

  const containers = body.containers === undefined
    ? booking.containers
    : body.containers;

  const containerKg = body.containerKg === undefined
    ? booking.container_kg
    : body.containerKg;

  const date = body.date === undefined
    ? booking.date
    : body.date;

  const status = body.status === undefined
    ? booking.status
    : body.status;

  if (
    !address ||
    typeof unit !== 'string' ||
    !Object.hasOwn(UNITS, unit)
  ) {
    throw new HttpError(
      400,
      'Enter an address and valid land unit.'
    );
  }

  if (typeof area !== 'number' || !(area > 0 && area < 1e6)) {
    throw new HttpError(400, 'Enter a valid land area.');
  }

  if (
    ![2500, 5000].includes(containerKg) ||
    !Number.isSafeInteger(containers) ||
    containers < 1 ||
    containers > 1e6
  ) {
    throw new HttpError(
      400,
      'Enter a valid container type and whole-number quantity.'
    );
  }

  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new HttpError(400, 'Choose a valid booking date.');
  }

  if (!['Pending', 'Confirmed', 'Rejected'].includes(status)) {
    throw new HttpError(400, 'Invalid status.');
  }

  const kg = Math.round(
    area * UNITS[unit] * SQFT_TO_HA * CONFIG.YIELD_KG_PER_HECTARE
  );

  const result = await db.prepare(
    `UPDATE bookings
     SET address=?,unit=?,area=?,kg=?,containers=?,
         container_kg=?,date=?,status=?
     WHERE id=?`
  ).run(
    address,
    unit,
    area,
    kg,
    containers,
    containerKg,
    date,
    status,
    id
  );

  if (!result.changes) {
    throw new HttpError(404, 'Booking not found.');
  }

  return {ok: true};
});

/* Delete booking — admin only */

route('DELETE', '/api/bookings/:id', async ({session, params}) => {
  requireAdmin(session);

  const id = Number(params.id);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, 'Invalid booking ID.');
  }

  const result = await db.prepare(
    'DELETE FROM bookings WHERE id = ?'
  ).run(id);

  if (!result.changes) {
    throw new HttpError(404, 'Booking not found.');
  }

  return {ok: true};
});

/* Booking photo */

route('GET', '/api/bookings/:id/photo', async ({session, params, res}) => {
  if (!session) {
    throw new HttpError(401, 'Please login first.');
  }

  const booking = await db.prepare(
    'SELECT user_id,photo,photo_mime FROM bookings WHERE id = ?'
  ).get(+params.id);

  if (
    !booking ||
    (
      session.role !== 'admin' &&
      booking.user_id !== session.user_id
    )
  ) {
    throw new HttpError(404, 'Not found.');
  }

  res.writeHead(200, {
    'Content-Type': booking.photo_mime,
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': booking.photo.length
  });

  res.end(Buffer.from(booking.photo));

  return undefined;
});

/* Support */

route('GET', '/api/support/contact', async () => supportContact);

route('POST', '/api/messages', async ({body, ip}) => {
  limit('msg:' + ip, 5, 10 * 60e3);

  const name = str(body.name, 80);
  const mobile = str(body.mobile, 10);
  const text = str(body.text, 2000);

  if (!name || !text || !/^[6-9]\d{9}$/.test(mobile)) {
    throw new HttpError(
      400,
      'Please fill name, a valid mobile number and message.'
    );
  }

  const saved = await db.prepare(
    'INSERT INTO messages (name,mobile,text,created_at) VALUES (?,?,?,?)'
  ).run(name, mobile, text, nowISO());

  const id = Number(saved.lastInsertRowid);

  const emailDelivery = await notifySupport({
    id,
    name,
    mobile,
    text
  });

  await db.prepare(
    'UPDATE messages SET email_delivery=? WHERE id=?'
  ).run(emailDelivery, id);

  return {ok: true, emailDelivery};
});

route('GET', '/api/messages', async ({session}) => {
  requireAdmin(session);

  return await db.prepare(
    `SELECT id,name,mobile,text,
            email_delivery AS emailDelivery,
            created_at AS createdAt
     FROM messages ORDER BY id`
  ).all();
});

/* Users — admin only */

route('GET', '/api/users', async ({session}) => {
  requireAdmin(session);

  return await db.prepare(
    `SELECT
       u.id,u.name,u.mobile,u.email,u.lang,
       u.created_at AS createdAt,
       u.last_login AS lastLogin,
       COUNT(b.id) AS bookings
     FROM users u
     LEFT JOIN bookings b ON b.user_id=u.id
     GROUP BY
       u.id,u.name,u.mobile,u.email,u.lang,
       u.created_at,u.last_login
     ORDER BY u.id`
  ).all();
});

/* Admin summary */

route('GET', '/api/admin/summary', async ({session}) => {
  requireAdmin(session);

  const counts = {};

  for (const table of ['users', 'bookings', 'centers', 'messages']) {
    counts[table] = (
      await db.prepare(
        'SELECT COUNT(*) AS count FROM ' + table
      ).get()
    ).count;
  }

  return counts;
});

/* Service status — admin only */

route('GET', '/api/admin/system', async ({session}) => {
  requireAdmin(session);

  await db.prepare('SELECT 1 AS ok').get();

  return {
    database: {
      type: db.kind,
      connected: true
    },
    email: {
      provider: 'Brevo',
      configured: !!(
        process.env.BREVO_API_KEY &&
        process.env.EMAIL_FROM
      )
    },
    supportEmailConfigured: !!supportContact.email
  };
});

module.exports = routes;
