'use strict';
require('../backend/config');
async function main(){
  const db=require('../backend/database');
  try {
    await db.ready;await db.prepare('SELECT 1 AS ok').get();
    console.log('Database connection: OK (' + db.kind + ')');
    if(db.kind !== 'postgres')console.log('Cloud database is NOT configured. DATABASE_URL is empty.');
    const emailReady=!!(process.env.BREVO_API_KEY && process.env.EMAIL_FROM);
    console.log('Brevo key and sender: ' + (emailReady ? 'configured (delivery not tested)' : 'not configured'));
    if(emailReady){
      try {
        const response=await fetch('https://api.brevo.com/v3/account',{headers:{'api-key':process.env.BREVO_API_KEY},signal:AbortSignal.timeout(10000)});
        console.log('Brevo account check: ' + (response.ok ? 'OK' : 'not verified (HTTP '+response.status+'; sending-only keys may not allow this check)'));
      } catch {console.log('Brevo account check: unavailable');}
    }
  } finally {if(db.kind==='postgres')await db.close();}
}
main().catch(error=>{console.error('Configuration check failed. Check your private settings. Code: '+(error.code||error.name));process.exitCode=1;});
