// Test-only PostgreSQL emulator; never loaded by npm start or production deployment.
const Module = require('node:module');
const {newDb} = require('pg-mem');
const mem = newDb();
const adapter = mem.adapters.createPg();
function compatible(sql){
  return sql.replace(/CREATE SCHEMA IF NOT EXISTS kurukalan;/g,'').replace(/REVOKE[^;]+;/g,'').replace(/SET search_path TO kurukalan;/g,'');
}
class Pool extends adapter.Pool {
  async query(text, values){
    if(typeof text==='string' && text.includes('pg_advisory_xact_lock'))return {rows:[{}],rowCount:1};
    return super.query(typeof text==='string'?compatible(text):text,values);
  }
}
// pg-mem connects by returning itself as the client; the override above covers both paths.
const original = Module._load;
Module._load = function(name, parent, isMain){return name==='pg'?{Pool}:original.call(this,name,parent,isMain);};
