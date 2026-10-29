// Isolated test provider; the running application never loads this file.
const fs = require('node:fs');
global.fetch = async (url, options) => {
  if (String(url) !== 'https://api.brevo.com/v3/smtp/email') throw new Error('Unexpected provider URL');
  const body = JSON.parse(options.body);
  if(body.subject.startsWith('Kurukalan support')) {
    fs.writeFileSync(process.env.TEST_EMAIL_CAPTURE, JSON.stringify({email:body.to[0].email,text:body.textContent}));
    return body.textContent.includes('SIMULATE_FAILURE') ? Response.json({error:'test failure'},{status:503}) : Response.json({messageId:'support-test'},{status:201});
  }
  const code = /code is (\d{6})/.exec(body.textContent)[1];
  fs.writeFileSync(process.env.TEST_EMAIL_CAPTURE, JSON.stringify({email:body.to[0].email,code}));
  return Response.json({messageId:'test-message'} , {status:201});
};
