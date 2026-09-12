const params = new URLSearchParams(location.search);
const type = params.get('type') || 'join';
const isJoin = type === 'join';
document.title = `${isJoin ? 'Join Core' : 'Apply'} — Synthavia AI`;

const skillOptions = ['Python', 'PyTorch / TF', 'Data analysis', 'NLP', 'Computer vision', 'Web / mobile', 'Product', 'Research writing', 'None yet'];
const languageOptions = ['English', 'Pidgin', 'Igbo'];
const trackOptions = [['ai-fellowship', 'AI Fellowship'], ['internship', 'Internship Program'], ['accelerator', 'AI Accelerator']];

// The application is three steps, so nothing is asked before it is needed and the last screen is a
// review. Answers live here until the final submit — one request, one record.
const answers = { name: '', email: '', track: trackOptions.find(([slug]) => slug === params.get('track'))?.[1] || 'AI Fellowship', language: 'English', skills: [], idea: '' };
let step = 1;

const steps = [[1, 'About you'], [2, 'Your background'], [3, 'Review']];
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function joinCard() {
  return `<p class="tag">JOIN CORE</p><form id="flowForm"><div class="hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off" /></label></div>
    <label>Name<input required name="name" placeholder="Your name" /></label>
    <label>Email<input required type="email" name="email" placeholder="you@example.com" /></label>
    <label>What are you looking for?<select name="interest"><option>Learn AI foundations</option><option>Join a project</option><option>Find a community</option><option>Share a resource</option></select></label>
    <button class="button" type="submit">Join Synthavia Core <span>→</span></button></form>
    <p class="form-note">Saved to the Synthavia server, and a copy goes to your inbox.</p>`;
}

function applyCard() {
  const body = {
    1: `<label>Name *<input required name="name" value="${esc(answers.name)}" placeholder="Your name" /></label>
        <label>Email *<input required type="email" name="email" value="${esc(answers.email)}" placeholder="you@example.com" /></label>
        <label>Which track? *<select name="track">${trackOptions.map(([, label]) => `<option${label === answers.track ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Interview language<select name="language">${languageOptions.map((label) => `<option${label === answers.language ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`,
    2: `<fieldset class="check-grid"><legend>What have you worked with? Pick all that apply</legend>
          ${skillOptions.map((skill) => `<label class="check"><input type="checkbox" name="skills" value="${esc(skill)}"${answers.skills.includes(skill) ? ' checked' : ''} />${esc(skill)}</label>`).join('')}</fieldset>
        <label>What do you want to build? *<textarea required name="idea" minlength="20" placeholder="A short, concrete description">${esc(answers.idea)}</textarea></label>`,
    3: `<dl class="review-list">
          <div><dt>Name</dt><dd>${esc(answers.name)}</dd></div>
          <div><dt>Email</dt><dd>${esc(answers.email)}</dd></div>
          <div><dt>Track</dt><dd>${esc(answers.track)}</dd></div>
          <div><dt>Interview language</dt><dd>${esc(answers.language)}</dd></div>
          <div><dt>Skills</dt><dd>${answers.skills.length ? esc(answers.skills.join(', ')) : 'None listed'}</dd></div>
          <div><dt>What you want to build</dt><dd>${esc(answers.idea)}</dd></div>
        </dl>
        <label class="check consent"><input type="checkbox" name="consent" />I confirm this is my own work and that Synthavia may store this application to assess it.</label>`
  }[step];

  return `<p class="tag">PROGRAM APPLICATION · STEP ${step} OF 3</p>
    <div class="step-track">${steps.map(([number, label]) => `<span class="${number === step ? 'on' : number < step ? 'done' : ''}">${String(number).padStart(2, '0')} ${label}</span>`).join('')}</div>
    <form id="flowForm"><div class="hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off" /></label></div>${body}
      <div class="step-actions">
        ${step > 1 ? '<button class="button button-quiet" type="button" data-back>← Back</button>' : ''}
        <button class="button" type="submit">${step === 3 ? 'Send application' : 'Continue'} <span>→</span></button>
      </div></form>
    <p class="form-note"></p>`;
}

function render() {
  const shellCopy = isJoin
    ? { eyebrow: 'SYNTHAVIA CORE', title: 'Start where<br />you <em>are.</em>', lede: 'Three quick questions help us point you to the right room. Core is free and it stays free.' }
    : { eyebrow: 'SYNTHAVIA PROGRAMS', title: 'Make your<br /><em>case.</em>', lede: 'Three steps. We read every application and reply to all of them — including the no’s.' };
  document.querySelector('#main').innerHTML = `<section class="flow-shell dot-grid">
    <div><p class="eyebrow">${shellCopy.eyebrow}</p><h1>${shellCopy.title}</h1><p>${shellCopy.lede}</p>
      <div class="flow-steps">${(isJoin ? ['01 · Tell us who you are', '02 · Choose a direction', '03 · Walk into the room'] : steps.map(([number, label]) => `0${number} · ${label}`)).map((line) => `<span>${line}</span>`).join('')}</div></div>
    <div class="flow-card">${isJoin ? joinCard() : applyCard()}</div></section>`;
}

// Step three of the join flow is the handover into the community rooms, so the links come from the
// admin's settings rather than being hard-coded — and if a room is not configured, we say so.
async function rooms() {
  try {
    const { settings } = await (await fetch('/api/settings')).json();
    const open = [
      settings.whatsapp && { href: settings.whatsapp, label: 'Open the WhatsApp room', hint: 'Where the day-to-day conversation happens' },
      settings.github && { href: settings.github, label: 'Open the GitHub org', hint: 'Issues marked good-first-issue are open now' }
    ].filter(Boolean);
    if (!open.length) {
      return `<div class="room-pending"><p class="tag">YOUR ROOMS</p><p>The WhatsApp and GitHub invite links are not published yet. Your invitation will arrive by email — we do not post a room link before it is live.</p></div>`;
    }
    return `<p class="tag room-heading">STEP 03 · YOUR ROOMS</p><div class="room-list">${open.map((room) => `<a class="room-link" href="${room.href}" target="_blank" rel="noopener noreferrer"><b>${room.label} <span>↗</span></b><span>${room.hint}</span></a>`).join('')}</div>`;
  } catch {
    return '';
  }
}

async function submit(form) {
  const note = document.querySelector('.form-note');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Sending…';
  const payload = isJoin
    ? { type: 'Core signup', ...Object.fromEntries(new FormData(form)) }
    : { type: 'Program application', name: answers.name, email: answers.email, track: `${answers.track} · ${answers.language} · ${answers.skills.join(', ') || 'no skills listed'}`, idea: answers.idea };
  try {
    const response = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    const card = document.querySelector('.flow-card');
    card.innerHTML = isJoin
      ? `<p class="tag">WELCOME IN</p><h2>You’re in the<br /><em>right room.</em></h2><p>Your reference is <strong>${result.id}</strong>, and a confirmation is on its way to your inbox.</p>${await rooms()}<div class="join-actions"><a class="button button-quiet" href="view.html?page=core">What runs inside Core <span>→</span></a></div>`
      : `<p class="tag">RECEIVED</p><h2>You’re in the<br /><em>right queue.</em></h2><p>Your reference is <strong>${result.id}</strong>, and a confirmation is on its way to your inbox. Two reviewers read every application, and we reply to all of them — including the no’s.</p><div class="join-actions"><a class="button" href="view.html?page=programs">Read about the tracks <span>→</span></a><a class="button button-quiet" href="index.html">Back home <span>↗</span></a></div>`;
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `${isJoin ? 'Join Synthavia Core' : 'Send application'} <span>→</span>`;
    if (note) note.textContent = error.message || 'Could not save your submission.';
  }
}

document.querySelector('#main').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.closest('#flowForm');
  if (!form) return;
  if (isJoin) return submit(form);

  const data = new FormData(form);
  if (step === 1) {
    answers.name = data.get('name');
    answers.email = data.get('email');
    answers.track = data.get('track');
    answers.language = data.get('language');
    step = 2;
    return render();
  }
  if (step === 2) {
    answers.skills = data.getAll('skills');
    answers.idea = data.get('idea');
    step = 3;
    return render();
  }
  if (!form.querySelector('[name="consent"]').checked) {
    document.querySelector('.form-note').textContent = 'Please confirm the statement before sending.';
    return;
  }
  submit(form);
});

document.querySelector('#main').addEventListener('click', (event) => {
  if (!event.target.closest('[data-back]')) return;
  // Keep what was typed on the current step before stepping back.
  const form = document.querySelector('#flowForm');
  const data = new FormData(form);
  if (step === 2) { answers.skills = data.getAll('skills'); answers.idea = data.get('idea') || ''; }
  step -= 1;
  render();
});

render();
