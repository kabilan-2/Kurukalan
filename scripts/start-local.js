'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),stdio:['inherit','pipe','inherit']});
let opened=false;
child.stdout.on('data',data=>{
  process.stdout.write(data);
  const address=/http:\/\/localhost:(\d+)/.exec(data.toString());
  if(address && !opened){
    opened=true;
    console.log('Keep this terminal open while using Kurukalan. Press Ctrl+C to stop.');
    const url='http://localhost:'+address[1];
    if(process.platform==='win32'){
      const browser=spawn('cmd.exe',['/c','start','',url],{stdio:'ignore',detached:true});
      browser.on('error',()=>console.log('Open '+url+' in your browser.'));browser.unref();
    }
  }
});
child.on('exit',code=>{process.exitCode=code||0;});
process.on('SIGINT',()=>child.kill('SIGINT'));
