const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
test('legacy phone users and related records survive email migration', () => {
  const folder = mkdtempSync(path.join(tmpdir(),'paddy-migration-'));
  try {
    const result = spawnSync(process.execPath,['-e',`
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(process.env.DB_PATH);
      db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,mobile TEXT NOT NULL UNIQUE,lang TEXT NOT NULL DEFAULT 'en',created_at TEXT NOT NULL,last_login TEXT NOT NULL); INSERT INTO users VALUES(7,'Legacy Farmer','9876543210','en','2026-01-01','2026-01-01'); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,role TEXT NOT NULL,user_id INTEGER REFERENCES users(id),expires_at INTEGER NOT NULL); INSERT INTO sessions VALUES('old-session','user',7,9999999999999)");
      db.close();
      const migrated=require('./backend/database');
      const row=migrated.prepare('SELECT * FROM users WHERE id=7').get();
      if(row.mobile!=='9876543210'||row.email!==null)throw Error('Legacy identity lost');
      if(migrated.prepare('SELECT COUNT(*) AS n FROM sessions').get().n!==0)throw Error('Legacy sign-in still active');
      migrated.prepare('INSERT INTO users(name,email,created_at,last_login) VALUES(?,?,?,?)').run('Email User','new@example.com','2026-01-01','2026-01-01');
      if(migrated.prepare('PRAGMA foreign_key_check').all().length)throw Error('Broken foreign keys');
    `],{cwd:path.join(__dirname,'..'),env:{...process.env,DB_PATH:path.join(folder,'legacy.db')},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
