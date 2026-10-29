const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {mkdtempSync, rmSync, readFileSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const net = require('node:net');
let child, base, directory, adminCookie, userCookie;
async function api(url, body, cookie, method) {
  const r = await fetch(base + url, {method:method || (body ? 'POST' : 'GET'), headers:{'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  return {status:r.status, cookie:r.headers.get('set-cookie')?.split(';')[0], body:await r.json()};
}
before(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'paddy-test-'));
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--require',path.join(__dirname,'mock-email.cjs'), 'server.js'], {cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DB_PATH:path.join(directory,'test.db'),ADMIN_ID:'admin',ADMIN_PASS:'test-only-strong-password',BREVO_API_KEY:'test-email-api-key',EMAIL_FROM:'sender@example.com',SUPPORT_EMAIL:'support@example.com',SUPPORT_MOBILE:'+919000000000',TEST_EMAIL_CAPTURE:path.join(directory,'email.json')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server failed to start')),10000);child.stdout.on('data',d=>{if(String(d).includes('server running')){clearTimeout(timeout);resolve();}});child.on('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});});
});
after(async()=>{if(child){child.kill();await new Promise(r=>child.once('exit',r));}rmSync(directory,{recursive:true,force:true});});
test('database and OTP access controls',async()=>{
  assert.equal((await api('/api/me')).body.role,null);
  assert.equal((await api('/api/users')).status,403);
  assert.equal((await api('/api/admin/summary')).status,403);
  assert.equal((await api('/api/centers')).body.length,9);
  assert.equal((await api('/api/login/user',{name:'Farmer',mobile:'9876543210',email:'farmer@example.com'})).status,400);
  assert.equal((await api('/api/login/user',{name:'Farmer',mobile:'9876543210',email:'farmer@example.com',code:'123456'})).status,400);
  assert.equal((await api('/api/auth/otp/send',{email:'invalid'})).status,400);
  assert.equal((await api('/api/auth/otp/send',{email:'farmer@example.com'})).status,200);
  const delivered = JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8')); assert.equal(delivered.email,'farmer@example.com');
  const wrongCode = delivered.code === '000000' ? '999999' : '000000';
  assert.equal((await api('/api/auth/otp/send',{email:'farmer@example.com'})).status,429);
  assert.equal((await api('/api/login/user',{name:'Farmer',mobile:'9876543210',email:'farmer@example.com',code:wrongCode})).status,401);
  assert.equal((await api('/api/me')).body.role,null);
  const login=await api('/api/signup/user',{name:'Farmer',mobile:'9876543210',email:'farmer@example.com',code:delivered.code});assert.equal(login.status,200);userCookie=login.cookie;
  assert.equal((await api('/api/login/user',{name:'Farmer',mobile:'9876543210',email:'farmer@example.com',code:delivered.code})).status,400);
  assert.equal((await api('/api/users',undefined,userCookie)).status,403);
  assert.equal((await api('/api/login/admin',{id:'admin',password:'123'})).status,401);
  const admin=await api('/api/login/admin',{id:'admin',password:'test-only-strong-password'});assert.equal(admin.status,200);adminCookie=admin.cookie;
  assert.match(admin.cookie,/^sid=/);
  const users=await api('/api/users',undefined,adminCookie);assert.equal(users.body.length,1);assert.equal(users.body[0].email,'farmer@example.com');
  const booking=await api('/api/bookings',{address:'Thanjavur',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:1,date:'2099-01-01'},userCookie);assert.equal(booking.status,200);assert.equal(booking.body.containers,1);assert.equal(booking.body.email,'farmer@example.com');assert.equal(booking.body.name,'Farmer');assert.equal(booking.body.mobile,'9876543210');assert.equal(booking.body.centerId,null);
  const spoofed = await api('/api/bookings',{name:'Spoofed name',mobile:'9000000000',email:'spoofed@example.com',containers:4,containerKg:5000,address:'Thanjavur',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:1,date:'2099-01-01',centerId:1},userCookie);assert.equal(spoofed.body.email,'farmer@example.com');assert.equal(spoofed.body.name,'Farmer');assert.equal(spoofed.body.mobile,'9876543210');assert.equal(spoofed.body.centerId,null);assert.equal(spoofed.body.containers,4);assert.equal(spoofed.body.containerKg,5000);
  const adminView=(await api('/api/bookings',undefined,adminCookie)).body.find(b=>b.id===spoofed.body.id);
  assert.equal(adminView.name,'Farmer');assert.equal(adminView.mobile,'9876543210');assert.equal(adminView.address,'Thanjavur');assert.equal(adminView.unit,'acre');assert.equal(adminView.area,1);assert.equal(adminView.containers,4);assert.equal(adminView.containerKg,5000);assert.equal(adminView.date,'2099-01-01');assert.match(adminView.photo,/\/photo$/);
  assert.equal((await api('/api/bookings',undefined,adminCookie)).body.length,2);
  assert.equal((await api('/api/bookings/'+booking.body.id,{status:'Confirmed'},adminCookie,'PATCH')).status,200);
  assert.equal((await api('/api/bookings',undefined,userCookie)).body[0].status,'Confirmed');
  assert.equal((await api('/api/admin/summary',undefined,adminCookie)).body.users,1);
  // Neither anonymous visitors nor registered farmers may mutate franchises or status.
  const newCenter = {name:'Test Franchise',district:'Thanjavur',person:'Test contact',phone:'9000000000',lat:10.8,lng:79.1,franchise:false};
  const beforeCenters = (await api('/api/centers')).body;
  for (const cookie of [undefined, userCookie]) {
    assert.equal((await api('/api/centers',newCenter,cookie)).status,403);
    assert.equal((await api('/api/centers/1',{franchise:false},cookie,'PATCH')).status,403);
    assert.equal((await api('/api/centers/1',{},cookie,'DELETE')).status,403);
    assert.equal((await api('/api/bookings/'+booking.body.id,{status:'Rejected'},cookie,'PATCH')).status,403);
  }
  assert.deepEqual((await api('/api/centers')).body,beforeCenters);
  assert.equal((await api('/api/bookings',undefined,userCookie)).body[0].status,'Confirmed');
  const added = await api('/api/centers',newCenter,adminCookie);
  assert.equal(added.status,200);assert.equal(added.body.franchise,false);
  assert.equal((await api('/api/centers/'+added.body.id,{franchise:'false'},adminCookie,'PATCH')).status,400);
  assert.equal((await api('/api/centers/'+added.body.id,{franchise:true},adminCookie,'PATCH')).status,200);
  assert.equal((await api('/api/centers')).body.find(c=>c.id===added.body.id).franchise,true);
  assert.equal((await api('/api/centers/'+added.body.id,{franchise:false},adminCookie,'PATCH')).status,200);
  assert.equal((await api('/api/centers')).body.find(c=>c.id===added.body.id).franchise,false);
  assert.equal((await api('/api/centers/'+added.body.id,{},adminCookie,'DELETE')).status,200);
  assert.deepEqual((await api('/api/centers')).body,beforeCenters);

  // Expiry and attempt exhaustion reject even the correct code.
  const {DatabaseSync} = require('node:sqlite');
  const inspectDb = new DatabaseSync(path.join(directory,'test.db'));
  await api('/api/auth/otp/send',{email:'expired@example.com'});
  const expiredCode = JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8')).code;
  const hashed = inspectDb.prepare('SELECT code_hash FROM email_otp_challenges WHERE email=?').get('expired@example.com');
  assert.notEqual(hashed.code_hash,expiredCode);
  inspectDb.prepare('UPDATE email_otp_challenges SET expires_at=0 WHERE email=?').run('expired@example.com');
  assert.equal((await api('/api/login/user',{name:'Expired',mobile:'9876543210',email:'expired@example.com',code:expiredCode})).status,400);
  await api('/api/auth/otp/send',{email:'locked@example.com'});
  const lockedCode = JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8')).code;
  const incorrect = lockedCode === '000000' ? '111111' : '000000';
  for(let i=0;i<5;i++) assert.equal((await api('/api/login/user',{name:'Locked',mobile:'9876543210',email:'locked@example.com',code:incorrect})).status,401);
  assert.equal((await api('/api/login/user',{name:'Locked',mobile:'9876543210',email:'locked@example.com',code:lockedCode})).status,429);
  // Returning users sign in to an existing account with email OTP.
  inspectDb.prepare('INSERT INTO users(name,mobile,email,created_at,last_login) VALUES(?,?,?,?,?)').run('Returning User','9123456780','returning@example.com','2026-01-01','2026-01-01');
  await api('/api/auth/otp/send',{email:'returning@example.com'});
  const returningCode = JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8')).code;
  const returning = await api('/api/login/user',{email:'returning@example.com',code:returningCode});
  assert.equal(returning.status,200);assert.equal(returning.body.mobile,'9123456780');assert.equal(returning.body.email,'returning@example.com');
  assert.equal((await api('/api/me',undefined,returning.cookie)).body.name,'Returning User');
  const savedBooking=await api('/api/bookings',{name:'Tampered',mobile:'9999999999',email:'fake@example.com',address:'Saved address',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:1,date:'2099-01-01'},returning.cookie);
  assert.equal(savedBooking.status,200);assert.equal(savedBooking.body.name,'Returning User');assert.equal(savedBooking.body.mobile,'9123456780');assert.equal(savedBooking.body.email,'returning@example.com');
  for (const values of [{containers:0},{containers:1.5},{containerKg:0},{containerKg:-5},{containerKg:1200}]) {
    const invalid = await api('/api/bookings',{address:'Test',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:1,date:'2099-01-01',...values},returning.cookie);
    assert.equal(invalid.status,400);
  }
  const largeType = await api('/api/bookings',{address:'Test',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:2,date:'2099-01-01',containerKg:5000},returning.cookie);
  assert.equal(largeType.status,200);assert.equal(largeType.body.containers,1);assert.equal(largeType.body.containerKg,5000);
  const smallType = await api('/api/bookings',{address:'Test',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:2,date:'2099-01-01',containerKg:2500},returning.cookie);
  assert.equal(smallType.status,200);assert.equal(smallType.body.containers,2);
  const automaticType = await api('/api/bookings',{address:'Test',photo:'data:image/png;base64,iVBORw0KGgo=',unit:'acre',area:2,date:'2099-01-01'},returning.cookie);
  assert.equal(automaticType.status,200);assert.equal(automaticType.body.containerKg,5000);assert.equal(automaticType.body.containers,1);
  inspectDb.close();
  assert.equal((await api('/api/support/contact')).body.email,'support@example.com');
  const support=await api('/api/messages',{name:'Customer',mobile:'9876543210',text:'Please help with my booking'});
  assert.equal(support.body.emailDelivery,'sent');
  const forwarded=JSON.parse(readFileSync(path.join(directory,'email.json'),'utf8'));
  assert.equal(forwarded.email,'support@example.com');assert.match(forwarded.text,/Please help/);
  const failedSupport=await api('/api/messages',{name:'Customer',mobile:'9876543210',text:'SIMULATE_FAILURE'});
  assert.equal(failedSupport.status,200);assert.equal(failedSupport.body.emailDelivery,'failed');
  const messages=await api('/api/messages',undefined,adminCookie);
  assert.equal(messages.body.length,2);assert.equal(messages.body[1].emailDelivery,'failed');
  await api('/api/logout',{},userCookie);assert.equal((await api('/api/me',undefined,userCookie)).body.role,null);
});
test('frontend files and private database boundary',async()=>{
  for(const file of ['/','/css/styles.css','/js/app.js','/js/api.js','/js/team.js','/js/translations.js','/js/scenes.js','/assets/center-container.png'])assert.equal((await fetch(base+file)).status,200,file);
  assert.equal((await fetch(base+'/data/paddy.db')).status,404);
  assert.equal((await fetch(base+'/.env')).status,404);
});
