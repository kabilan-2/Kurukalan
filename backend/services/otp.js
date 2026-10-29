'use strict';
const crypto = require('node:crypto');
const db = require('../database');
const {HttpError} = require('../helpers');
function secret() {
  const key = process.env.OTP_SECRET || process.env.BREVO_API_KEY;
  if (!key) throw new HttpError(503, 'Email verification is not configured. Please contact the administrator.');
  return key;
}
const hash = (email, nonce, code) => crypto.createHmac('sha256', secret()).update(email + ':' + nonce + ':' + code).digest('hex');
async function send(email) {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) throw new HttpError(503, 'Email verification is not configured. Please contact the administrator.');
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const nonce = crypto.randomBytes(24).toString('hex');
  const codeHash = hash(email, nonce, code);
  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:'POST', signal:AbortSignal.timeout(15000),
      headers:{'api-key':process.env.BREVO_API_KEY, 'Content-Type':'application/json', Accept:'application/json'},
      body:JSON.stringify({sender:{name:'Kurukalan', email:process.env.EMAIL_FROM}, to:[{email}],
        subject:'Your Kurukalan sign-in code', textContent:`Your Kurukalan sign-in code is ${code}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.`})
    });
  } catch { throw new HttpError(503, 'Email service unavailable. Please try again later.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.messageId) {
    if (response.status === 429) throw new HttpError(429, 'Email sending limit reached. Please try again later.');
    throw new HttpError(503, 'Could not send the email. The administrator should check the provider account, verified sender and sending limits.');
  }
  // No plaintext code is stored, logged, or returned to the browser.
  await db.prepare(`INSERT INTO email_otp_challenges(email,nonce,code_hash,expires_at) VALUES(?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET nonce=excluded.nonce,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0`)
    .run(email, nonce, codeHash, Date.now() + 10 * 60e3);
}
async function check(email, code) {
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the six-digit code from your email.');
  // Atomic conditional deletion allows only one request to consume a valid code, including across cloud connections.
  const challenge = await db.prepare('SELECT * FROM email_otp_challenges WHERE email=?').get(email);
  if (!challenge || challenge.expires_at < Date.now()) throw new HttpError(400, 'Code expired or unavailable. Request a new code.');
  if (challenge.attempts >= 5) throw new HttpError(429, 'Too many incorrect codes. Request a new code.');
  const expected = Buffer.from(challenge.code_hash, 'hex');
  const actual = Buffer.from(hash(email, challenge.nonce, code), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) {
    await db.prepare('UPDATE email_otp_challenges SET attempts=attempts+1 WHERE email=?').run(email);
    throw new HttpError(401, 'Incorrect verification code.');
  }
  const consumed = await db.prepare('DELETE FROM email_otp_challenges WHERE email=? AND code_hash=? AND expires_at>=? AND attempts<5').run(email,challenge.code_hash,Date.now());
  if (!consumed.changes) throw new HttpError(400, 'This verification code is no longer valid.');
}
module.exports = {send, check};
