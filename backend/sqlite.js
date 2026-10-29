const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {CONFIG} = require('./config');
fs.mkdirSync(path.dirname(CONFIG.DB_PATH), { recursive: true });
const db = new DatabaseSync(CONFIG.DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mobile TEXT UNIQUE,
  email TEXT UNIQUE,
  lang TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL,
  last_login TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, name_ta TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL, person TEXT NOT NULL, phone TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  franchise INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mobile TEXT NOT NULL, email TEXT, address TEXT NOT NULL,
  photo BLOB NOT NULL, photo_mime TEXT NOT NULL,
  unit TEXT NOT NULL, area REAL NOT NULL, kg INTEGER NOT NULL, containers INTEGER NOT NULL, container_kg INTEGER NOT NULL DEFAULT 2500,
  date TEXT NOT NULL,
  center_id INTEGER REFERENCES centers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, mobile TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
`);

db.exec(`CREATE TABLE IF NOT EXISTS email_otp_challenges (
  email TEXT PRIMARY KEY, nonce TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
)`);
// Preserve existing phone accounts and booking history while adding email identity.
const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (userColumns.find(c => c.name === 'mobile')?.notnull) {
  db.exec(`PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
    CREATE TABLE users_email_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, mobile TEXT UNIQUE,
      email TEXT UNIQUE, lang TEXT NOT NULL DEFAULT 'en', created_at TEXT NOT NULL, last_login TEXT NOT NULL
    );
    INSERT INTO users_email_migration(id,name,mobile,lang,created_at,last_login)
      SELECT id,name,mobile,lang,created_at,last_login FROM users;
    DROP TABLE users;
    ALTER TABLE users_email_migration RENAME TO users;
    COMMIT; PRAGMA foreign_keys=ON;`);
}
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
if (!db.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'email')) db.exec('ALTER TABLE bookings ADD COLUMN email TEXT');
if (!db.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'container_kg')) db.exec('ALTER TABLE bookings ADD COLUMN container_kg INTEGER NOT NULL DEFAULT 2500');
if (!db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'email_delivery')) db.exec("ALTER TABLE messages ADD COLUMN email_delivery TEXT NOT NULL DEFAULT 'not_configured'");
// Existing phone-only sessions cannot bypass email verification.
db.exec("DELETE FROM sessions WHERE role='user' AND user_id IN (SELECT id FROM users WHERE email IS NULL)");

if (db.prepare('SELECT COUNT(*) AS n FROM centers').get().n === 0) {
  const ins = db.prepare('INSERT INTO centers (name,name_ta,district,person,phone,lat,lng,franchise) VALUES (?,?,?,?,?,?,?,?)');
  require('./seed-centers').forEach(r => ins.run(...r));

}
const cleanSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
cleanSessions(); setInterval(cleanSessions, 3600e3).unref();


db.ready = Promise.resolve();
db.kind = 'sqlite';
module.exports = db;
