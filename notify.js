// Outbound email. With SYNTHAVIA_EMAIL_ENDPOINT and SYNTHAVIA_EMAIL_KEY set, messages are POSTed to
// a transactional email API (Resend, Postmark, SendGrid and friends all accept this shape). Without
// them — and whenever a send fails — the message is kept in the outbox so nothing is silently lost
// and the admin can see exactly what would have gone out. Retry from the admin's Outbox once the key
// is set. Messages live in the database alongside everything else.
const crypto = require('node:crypto');
const store = require('./db.js');

const endpoint = process.env.SYNTHAVIA_EMAIL_ENDPOINT || '';
const apiKey = process.env.SYNTHAVIA_EMAIL_KEY || '';
const fromAddress = process.env.SYNTHAVIA_EMAIL_FROM || 'Synthavia AI <no-reply@synthavia.org>';
const postalAddress = process.env.SYNTHAVIA_ADDRESS || '44b Aba Owerri Road, Aba, Abia State, Nigeria';
const configured = Boolean(endpoint && apiKey);

// Which inbox owns which form. The addresses themselves are admin settings, so they can change
// without a deploy; this only decides which of them a given form belongs to.
const inboxFor = {
  'Core signup': 'programsEmail',
  'Program application': 'programsEmail',
  'Partner enquiry': 'partnersEmail',
  'Contact message': 'teamEmail',
  'Newsletter signup': 'teamEmail'
};

const replyWindows = {
  'Core signup': 'You will hear from us within three working days.',
  'Program application': "We read every application and reply to all of them — including the no's. Expect a decision within three weeks.",
  'Partner enquiry': 'The partnerships lead replies within five working days.',
  'Contact message': 'Someone from the right team will reply within three working days.',
  'Newsletter signup': 'You will get one email per post, plus a monthly roundup. Unsubscribe in one click.'
};

// What each form sends: one acknowledgement to the person, one notification to the owning inbox.
function compose(entry, inboxes) {
  const inbox = inboxes[inboxFor[entry.type]] || inboxes.teamEmail;
  const replyWindow = replyWindows[entry.type] || '';
  const signature = `— Synthavia AI\n${postalAddress}`;
  const messages = [];

  if (entry.type !== 'Newsletter signup') {
    messages.push({
      to: entry.email,
      // A reply to the acknowledgement has to reach a person, not the unattended from-address.
      replyTo: inbox,
      subject: `Synthavia AI — we have your ${entry.type.toLowerCase()} (${entry.id})`,
      body: `${entry.name ? `Hello ${entry.name},` : 'Hello,'}\n\nWe have your ${entry.type.toLowerCase()}. Your reference is ${entry.id}.\n\n${replyWindow}\n\nReply to this email if you need to add anything.\n\n${signature}`
    });
  } else {
    messages.push({ to: entry.email, replyTo: inbox, subject: 'Synthavia AI — you are on the list', body: `Thanks for subscribing.\n\n${replyWindow}\n\n${signature}` });
  }

  const detail = Object.entries(entry)
    .filter(([key, value]) => value && !['id', 'createdAt', 'type'].includes(key))
    .map(([key, value]) => `${key}: ${value}`).join('\n');
  messages.push({
    to: inbox,
    // Replying to the notification answers the person who wrote in, which is almost always the point.
    replyTo: entry.email || '',
    subject: `[${entry.type}] ${entry.name || entry.organisation || entry.email} — ${entry.id}`,
    body: `A new ${entry.type.toLowerCase()} came in.\n\n${detail}\n\nReceived ${new Date(entry.createdAt).toUTCString()}.`
  });
  return messages;
}

async function send(message) {
  const payload = { from: fromAddress, to: [message.to], subject: message.subject, text: message.body };
  if (message.replyTo) payload.reply_to = message.replyTo;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    // The provider's own message says what is actually wrong — an unverified sending domain, a
    // revoked key — and guessing wastes the reader's time, so it is kept verbatim.
    const detail = await response.text().catch(() => '');
    throw new Error(`Email API returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
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
    await store.addMessage(record);
  }
}

async function retry() {
  if (!configured) return { retried: 0, failed: 0, configured };
  let retried = 0;
  let failed = 0;
  for (const record of await store.outbox(500)) {
    if (record.status === 'sent') continue;
    record.attempts += 1;
    try {
      await send(record);
      record.status = 'sent'; record.sentAt = new Date().toISOString(); record.error = '';
      retried += 1;
    } catch (error) {
      record.status = 'failed'; record.error = error.message;
      failed += 1;
    }
    await store.updateMessage(record);
  }
  return { retried, failed, configured };
}

// A one-off send so delivery can be proved from the admin without waiting for a real submission.
// It goes through the same code path as everything else and is recorded in the outbox like any
// other message, so a failure here is the same failure a visitor's acknowledgement would hit.
async function sendTest(recipient) {
  const record = {
    id: `MSG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    createdAt: new Date().toISOString(),
    to: recipient,
    subject: 'Synthavia AI — test email',
    body: `This is a test from the Synthavia admin.\n\nIf you are reading it, form acknowledgements and team notifications will be delivered too.\n\nSent ${new Date().toUTCString()}.\n\n— Synthavia AI\n${postalAddress}`,
    status: 'queued',
    attempts: 0
  };
  if (!configured) {
    record.error = 'No email endpoint configured — set SYNTHAVIA_EMAIL_ENDPOINT and SYNTHAVIA_EMAIL_KEY.';
    await store.addMessage(record);
    return { sent: false, configured, error: record.error };
  }
  record.attempts = 1;
  try {
    await send(record);
    record.status = 'sent';
    record.sentAt = new Date().toISOString();
    await store.addMessage(record);
    return { sent: true, configured, to: recipient };
  } catch (error) {
    record.status = 'failed';
    record.error = error.message;
    await store.addMessage(record);
    return { sent: false, configured, error: error.message };
  }
}

module.exports = { compose, dispatch, retry, sendTest, configured, from: fromAddress };
