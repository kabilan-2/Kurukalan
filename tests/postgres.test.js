const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtempSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const net=require('node:net');
test('cloud SQL adapter stores bookings with admin visibility and atomic OTP consumption',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'kurukalan-cloud-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  let child;
  try {
    child=spawn(process.execPath,['--require',path.join(__dirname,'mock-postgres.cjs'),'--require',path.join(__dirname,'mock-email.cjs'),'server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATABASE_URL:'postgresql://test:test@localhost/test',REQUIRE_CLOUD_DATABASE:'1',ADMIN_PASS:'cloud-test-password',BREVO_API_KEY:'test-key',EMAIL_FROM:'sender@example.com',TEST_EMAIL_CAPTURE:path.join(directory,'email.json')},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',d=>errors+=d);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Cloud server startup timeout: '+errors)),10000);child.stdout.on('data',d=>{if(String(d).includes('server running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(new Error('Cloud startup failed: '+errors));});});
    async function api(url,body,cookie,method){const r=await fetch('http://127.0.0.1:'+port+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],body:await r.json()};}
    assert.equal((await api('/api/centers')).body.length,9);
    const admin=await api('/api/login/admin',{id:'admin',password:'cloud-test-password'});assert.equal(admin.status,200);
    assert.equal((await api('/api/admin/system',undefined,admin.cookie)).body.database.type,'postgres');
    assert.equal((await api('/api/auth/otp/send',{email:'cloud@example.com'})).status,200);
    const code=JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8')).code;
    const credentials={name:'Cloud Farmer',mobile:'9876543210',email:'cloud@example.com',code};
    const raced=await Promise.all([api('/api/signup/user',credentials),api('/api/signup/user',credentials)]);
    const good=raced.find(r=>r.status===200);assert.ok(good,JSON.stringify(raced));assert.equal(raced.filter(r=>r.status===200).length,1);
    const booked=await api('/api/bookings',{address:'Cloud Village',photo:'data:image/png;base64,dGVzdA==',unit:'acre',area:2,date:'2099-01-01',containerKg:5000,containers:3},good.cookie);
    assert.equal(booked.status,200,JSON.stringify(booked));assert.equal(booked.body.name,'Cloud Farmer');assert.equal(booked.body.containers,3);
    const rows=await api('/api/bookings',undefined,admin.cookie);assert.equal(rows.body.length,1);assert.equal(rows.body[0].mobile,'9876543210');assert.equal(rows.body[0].email,'cloud@example.com');assert.equal(rows.body[0].containerKg,5000);
    const users=await api('/api/users',undefined,admin.cookie);assert.equal(users.status,200,errors);assert.ok(users.body[0].createdAt);assert.equal(users.body[0].bookings,1);
    assert.equal((await api('/api/bookings/'+booked.body.id,{status:'Confirmed'},admin.cookie,'PATCH')).status,200);
    assert.equal((await api('/api/bookings',undefined,good.cookie)).body[0].status,'Confirmed');
    const photo=await fetch('http://127.0.0.1:'+port+booked.body.photo,{headers:{Cookie:admin.cookie}});assert.equal(photo.status,200);assert.equal((await photo.arrayBuffer()).byteLength,4);
  } finally {if(child && child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(directory,{recursive:true,force:true});}
});
