// Outbound email. With SYNTHAVIA_EMAIL_ENDPOINT set, messages are POSTed to a transactional email
// API (Resend, Postmark, SendGrid and friends all accept this shape). Without it — and whenever a
// send fails — the message is kept in the outbox so nothing is silently lost and the admin
// can see exactly what would have gone out. Retry from the admin's Outbox once the key is set.
// Messages live in the database alongside everything else.
const crypto = require('node:crypto');
const store = require('./db.js');

const endpoint = process.env.SYNTHAVIA_EMAIL_ENDPOINT || '';
const apiKey = process.env.SYNTHAVIA_EMAIL_KEY || '';
const fromAddress = process.env.SYNTHAVIA_EMAIL_FROM || 'Synthavia AI <no-reply@synthavia.ai>';
const configured = Boolean(endpoint && apiKey);

// What each form sends: one acknowledgement to the person, one notification to the owning inbox.
function compose(entry, inboxes) {
  const inbox = {
    'Core signup': inboxes.programsEmail,
    'Program application': inboxes.programsEmail,
    'Partner enquiry': inboxes.partnersEmail,
    'Contact message': inboxes.teamEmail,
    'Newsletter signup': inboxes.teamEmail
  }[entry.type] || inboxes.teamEmail;

  const replyWindow = {
    'Core signup': 'You will hear from us within three working days.',
    'Program application': 'We read every application and reply to all of them — including the no\'s. Expect a decision within three weeks.',
    'Partner enquiry': 'The partnerships lead replies within five working days.',
    'Contact message': 'Someone from the right team will reply within three working days.',
    'Newsletter signup': 'You will get one email per post, plus a monthly roundup. Unsubscribe in one click.'
  }[entry.type] || '';

  const messages = [];
  if (entry.type !== 'Newsletter signup') {
    messages.push({
      to: entry.email,
      subject: `Synthavia AI — we have your ${entry.type.toLowerCase()} (${entry.id})`,
      body: `${entry.name ? `Hello ${entry.name},` : 'Hello,'}\n\nWe have your ${entry.type.toLowerCase()}. Your reference is ${entry.id}.\n\n${replyWindow}\n\n— Synthavia AI\nAba, Abia State, Nigeria`
    });
  } else {
    messages.push({ to: entry.email, subject: 'Synthavia AI — you are on the list', body: `Thanks for subscribing.\n\n${replyWindow}\n\n— Synthavia AI` });
  }
  const detail = Object.entries(entry)
    .filter(([key, value]) => value && !['id', 'createdAt', 'type'].includes(key))
    .map(([key, value]) => `${key}: ${value}`).join('\n');
  messages.push({
    to: inbox,
    subject: `[${entry.type}] ${entry.name || entry.organisation || entry.email} — ${entry.id}`,
    body: `A new ${entry.type.toLowerCase()} came in.\n\n${detail}\n\nReceived ${new Date(entry.createdAt).toUTCString()}.`
  });
  return messages;
}

async function send(message) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from: fromAddress, to: [message.to], subject: message.subject, text: message.body })
  });
  if (!response.ok) throw new Error(`Email API returned ${response.status}`);
}

// Never let a delivery problem fail the submission the visitor just made.
async function dispatch(messages) {
  for (const message of messages) {
    const record = { id: `MSG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, createdAt: new Date().toISOString(), status: 'queued', attempts: 0, ...message };
    if (configured) {
      record.attempts = 1;
      try { await send(message); record.status = 'sent'; record.sentAt = new Date().toISOString(); }
      catch (error) { record.status = 'failed'; record.error = error.message; }
    } else {
      record.error = 'No email endpoint configured — set SYNTHAVIA_EMAIL_ENDPOINT and SYNTHAVIA_EMAIL_KEY.';
    }
    store.addMessage(record);
  }
}

async function retry() {
  if (!configured) return { retried: 0, configured };
  let retried = 0;
  for (const record of store.outbox(500)) {
    if (record.status === 'sent') continue;
    record.attempts += 1;
    try { await send(record); record.status = 'sent'; record.sentAt = new Date().toISOString(); record.error = ''; retried += 1; }
    catch (error) { record.status = 'failed'; record.error = error.message; }
    store.updateMessage(record);
  }
  return { retried, configured };
}

module.exports = { compose, dispatch, retry, configured };
