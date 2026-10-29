const contact = require('../support-config');
async function notifySupport(message) {
  if (!contact.email || !process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) return 'not_configured';
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:'POST',signal:AbortSignal.timeout(15000),
      headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({sender:{name:'Kurukalan Support',email:process.env.EMAIL_FROM},to:[{email:contact.email}],
        subject:`Kurukalan support request #${message.id}`,
        textContent:`Support request #${message.id}\nName: ${message.name}\nMobile: ${message.mobile}\n\n${message.text}`})
    });
    const result = await response.json().catch(() => ({}));
    return response.ok && result.messageId ? 'sent' : 'failed';
  } catch { return 'failed'; }
}
module.exports = {notifySupport};
