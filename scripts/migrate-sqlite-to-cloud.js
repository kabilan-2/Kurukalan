'use strict';
require('../backend/config');
const path = require('node:path');
const {DatabaseSync}=require('node:sqlite');
async function main(){
  if(!process.env.DATABASE_URL)throw new Error('Cloud database must be configured first');
  if(!process.argv[2])throw new Error('Supply the path to your backed-up SQLite database');
  const source=new DatabaseSync(path.resolve(process.argv[2]),{readOnly:true});
  const db=require('../backend/database');
  try {
    await db.ready;
    await db.transaction(async client=>{
      await client.query('LOCK TABLE users,centers,bookings,messages IN ACCESS EXCLUSIVE MODE');
      for(const table of ['users','bookings','messages']) {
        const result=await client.query('SELECT COUNT(*)::int AS n FROM '+table);
        if(result.rows[0].n)throw new Error('Target database is not empty; import stopped');
      }
      await client.query('DELETE FROM centers');
      const tables={
        users:['id','name','mobile','email','lang','created_at','last_login'],
        centers:['id','name','name_ta','district','person','phone','lat','lng','franchise'],
        bookings:['id','user_id','name','mobile','email','address','photo','photo_mime','unit','area','kg','containers','container_kg','date','center_id','status','created_at'],
        messages:['id','name','mobile','text','created_at','email_delivery']
      };
      for(const [table,columns] of Object.entries(tables)){
        const rows=source.prepare('SELECT * FROM '+table).all();
        for(const row of rows){
          const values=columns.map(c=>c==='photo'?Buffer.from(row[c]):row[c]??(c==='container_kg'?2500:c==='email_delivery'?'not_configured':null));
          await client.query('INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map((_,i)=>'$'+(i+1)).join(',')+')',values);
        }
        await client.query("SELECT setval(pg_get_serial_sequence('kurukalan."+table+"','id'),COALESCE((SELECT MAX(id) FROM "+table+"),1),(SELECT COUNT(*)>0 FROM "+table+"))");
        console.log(table+': '+rows.length+' records copied');
      }
    });
    console.log('Import committed. Old login sessions and OTPs were not copied; sign in again.');
  } finally{source.close();await db.close();}
}
main().catch(()=>{console.error('Import failed or target is not empty. No partial import was committed. Check the source path and cloud configuration.');process.exitCode=1;});
