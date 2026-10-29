'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Pool} = require('pg');
// Strip URL SSL options so they cannot override certificate verification below.
const connection = new URL(process.env.DATABASE_URL);
for (const key of ['sslmode','sslcert','sslkey','sslrootcert','uselibpqcompat']) connection.searchParams.delete(key);
const ca = process.env.DATABASE_CA_CERT || (process.env.DATABASE_CA_FILE ? fs.readFileSync(process.env.DATABASE_CA_FILE,'utf8') : undefined);
const pool = new Pool({connectionString:connection.toString(),max:3,
  ssl:{rejectUnauthorized:true,...(ca ? {ca} : {})},connectionTimeoutMillis:10000,idleTimeoutMillis:30000,
  options:'-c search_path=kurukalan -c statement_timeout=15000'});
pool.on('error', () => console.error('Database connection interrupted. Requests will retry a connection.'));
function sqlText(sql) {
  let i=0;
  // Application SQL is fixed, not user-supplied; placeholders never occur in literals.
  return sql.replace(/\?/g,()=>'$'+(++i)).replace(/\bAS\s+([a-z]\w*[A-Z]\w*)/g,'AS "$1"');
}
function normalize(row) {
  if(!row) return row;
  for(const key of ['count','n','bookings']) if(typeof row[key]==='string') row[key]=Number(row[key]);
  return row;
}
const db = {
  kind:'postgres',
  prepare(sql) {
    const text=sqlText(sql);
    return {
      async get(...values) {return normalize((await pool.query(text,values)).rows[0]);},
      async all(...values) {return (await pool.query(text,values)).rows.map(normalize);},
      async run(...values) {
        const returnsId=/^\s*INSERT\s+INTO\s+(users|centers|bookings|messages)\b/i.test(text) && !/\bRETURNING\b/i.test(text);
        const result=await pool.query(text+(returnsId?' RETURNING id':''),values);
        return {changes:result.rowCount,lastInsertRowid:result.rows?.[0]?.id};
      }
    };
  },
  async exec(sql) {await pool.query(sqlText(sql));},
  async transaction(work){
    const client=await pool.connect();
    try {await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  },
  async close(){await pool.end();}

};
db.ready=(async()=>{
  // One session serializes schema initialization across concurrent instances.
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(17490382)');
    await client.query(fs.readFileSync(path.join(__dirname,'sql/postgres.sql'),'utf8'));
    const seeded=await client.query("SELECT value FROM app_metadata WHERE key='centers_seeded'");
    if(!seeded.rows.length) {
      for(const row of require('./seed-centers')) await client.query('INSERT INTO centers(name,name_ta,district,person,phone,lat,lng,franchise) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',row);
      await client.query("INSERT INTO app_metadata(key,value) VALUES('centers_seeded','1')");
    }
    await client.query('COMMIT');
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
  const clean=()=>db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).catch(()=>{});
  await clean();setInterval(clean,3600e3).unref();
})();
module.exports=db;
