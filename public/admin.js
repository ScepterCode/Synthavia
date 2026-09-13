// Unlisted route. The stat sign-off and the content tables here are what the public pages read from.
const adminTokenKey = 'synthavia-admin-session';
const state = { view: 'dashboard', filter: 'All', editing: null, records: [], metrics: [], content: null, settings: [], outbox: { messages: [], configured: false }, me: null, users: [], analytics: null };
const main = document.querySelector('#main');

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function token() { return sessionStorage.getItem(adminTokenKey); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...options.headers } });
  if (response.status === 401) { sessionStorage.removeItem(adminTokenKey); loginScreen('Your admin session has expired.'); throw new Error('unauthorised'); }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'That did not save.');
  return body;
}
function when(value) { return value ? new Date(value).toLocaleString() : '—'; }

/* ---------- Editable collections ---------- */

const collections = {
  events: {
    label: 'Events', action: 'New event', stateKey: 'status_publish', states: ['Published', 'Draft'],
    note: 'Publishing an event with a start date in the future turns on the public countdown. Drafts never appear on the site, so an undated edition stays invisible until the venue is booked.',
    columns: ['Event', 'Date', 'Venue', 'Status'],
    fields: [['title', 'Title'], ['subtitle', 'Subtitle'], ['date', 'Date label'], ['startsAt', 'Start date (YYYY-MM-DD, blank if unset)'], ['venue', 'Venue'], ['format', 'Format'], ['badge', 'Badge'], ['blurb', 'Summary', 'textarea']],
    cells: (item) => [[item.title, item.slug], item.date || 'Date not set', item.venue || 'Venue pending']
  },
  posts: {
    label: 'Blog posts', action: 'New post', stateKey: 'status_publish', states: ['Published', 'In review', 'Draft'],
    note: 'Posts in review are visible to editors only. The public list shows published posts and nothing else — no teaser cards for unwritten articles.',
    columns: ['Post', 'Category', 'Author', 'Status'],
    fields: [['title', 'Title'], ['dek', 'Standfirst', 'textarea'], ['category', 'Category'], ['date', 'Date label'], ['read', 'Read time'], ['author', 'Author'], ['initials', 'Initials']],
    cells: (item) => [[item.title, item.slug], item.category, item.author]
  },
  partners: {
    label: 'Partners', action: 'Add partner', stateKey: 'agreement', states: ['Confirmed', 'Unsigned', 'Verbal'],
    note: 'A logo only goes public when the agreement is countersigned. Only rows marked Confirmed appear in the public partners grid — everything else keeps that grid in its empty state.',
    columns: ['Organisation', 'Tier', 'Owner', 'Agreement'],
    fields: [['name', 'Organisation'], ['note', 'Note'], ['tier', 'Tier'], ['owner', 'Owner']],
    cells: (item) => [[item.name, item.note], item.tier, item.owner]
  },
  resources: {
    label: 'Resources', action: 'New resource', stateKey: 'status_publish', states: ['Published', 'Draft'],
    note: 'The Core resource library. Leave the URL blank and the public list shows the item as “in preparation” rather than a broken download — publish the file first, then paste the link.',
    columns: ['Resource', 'Kind', 'Link', 'Status'],
    fields: [['title', 'Title'], ['kind', 'Kind (PDF, Dataset, Notebook…)'], ['url', 'Download URL (blank = in preparation)'], ['detail', 'Description', 'textarea']],
    cells: (item) => [[item.title, item.slug], item.kind, item.url ? 'Live' : 'Not set']
  },
  testimonials: {
    label: 'Testimonials', action: 'Add testimonial', stateKey: 'status_publish', states: ['Published', 'Draft'],
    note: 'A quote is a real person\'s words. Publish one only with their name, their role and their consent — the home page shows an honest empty state until then, and never a made-up endorsement.',
    columns: ['Quote', 'Name', 'Role', 'Status'],
    fields: [['quote', 'Quote', 'textarea'], ['name', 'Name'], ['role', 'Role and organisation']],
    cells: (item) => [[item.quote ? `“${item.quote.slice(0, 60)}${item.quote.length > 60 ? '…' : ''}”` : '—', item.slug], item.name, item.role]
  },
  team: {
    label: 'Team', action: 'Add person', stateKey: 'status_publish', states: ['Published', 'Draft'],
    note: 'Profiles on the public About page. A person is published only with their own name, role and consent. Photos are uploaded here — they are downscaled in the browser before upload, so a phone photo is fine.',
    columns: ['Person', 'Role', 'Photo', 'Status'],
    fields: [['name', 'Full name'], ['role', 'Role'], ['bio', 'Short bio', 'textarea'], ['photo', 'Photo', 'image'], ['link', 'Profile link (optional)'], ['order', 'Sort order (1 = first)']],
    cells: (item) => [[item.name, item.role ? '' : 'role missing'], item.role, item.photo ? 'Uploaded' : 'None']
  },
  projects: {
    label: 'Lab projects', action: 'New project', stateKey: 'status_publish', states: ['Published', 'Draft'],
    note: 'Drafts stay off the Lab index and have no case-study page. A project appears publicly once it has a written problem statement and an owner.',
    columns: ['Project', 'Headline metric', 'Field status', 'Status'],
    fields: [['title', 'Title'], ['status', 'Field status'], ['metric', 'Headline metric'], ['metricLabel', 'Metric caption'], ['result', 'Result', 'textarea']],
    cells: (item) => [[item.title, item.slug], item.metric, item.status]
  }
};
const tone = { Published: 'ok', Confirmed: 'ok', Draft: 'warm', Unsigned: 'warm', 'In review': 'cyan', Verbal: 'muted' };

/* ---------- Sign in ---------- */

async function loginScreen(message = '') {
  // On a fresh install there is no account yet, so the first screen creates the owner.
  let setupNeeded = false;
  try { setupNeeded = (await (await fetch('/api/admin/setup')).json()).needed; } catch {}
  main.innerHTML = setupNeeded
    ? `<section class="admin-login dot-grid"><p class="eyebrow">SYNTHAVIA ADMIN · FIRST RUN</p><h1>Create the<br /><em>owner account.</em></h1>
        <p>No account exists yet. This first one is the owner: it can manage other accounts and sign off public figures. Choose a password of at least 12 characters — it is hashed with scrypt and never stored in the clear.</p>
        <form id="adminSetup">
          <label>Your name<input required name="name" autocomplete="name" /></label>
          <label>Email<input required type="email" name="email" autocomplete="username" /></label>
          <label>Password<input required type="password" name="password" minlength="12" autocomplete="new-password" /></label>
          <button class="button" type="submit">Create owner account <span>→</span></button></form>
        <p class="form-note">${esc(message)}</p></section>`
    : `<section class="admin-login dot-grid"><p class="eyebrow">SYNTHAVIA ADMIN · UNLISTED ROUTE</p><h1>Sign in to<br /><em>the control room.</em></h1>
        <p>Team accounts only. Sessions last eight hours and are stored server-side.</p>
        <form id="adminLogin">
          <label>Email<input required type="email" name="email" autocomplete="username" /></label>
          <label>Password<input required type="password" name="password" autocomplete="current-password" /></label>
          <button class="button" type="submit">Open admin <span>→</span></button></form>
        <p class="form-note">${esc(message)}</p></section>`;

  const form = document.querySelector('#adminSetup, #adminLogin');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const endpoint = form.id === 'adminSetup' ? '/api/admin/setup' : '/api/admin/login';
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      sessionStorage.setItem(adminTokenKey, result.token);
      load();
    } catch (error) { loginScreen(error.message || 'Sign-in failed.'); }
  });
}

async function load() {
  if (!token()) return loginScreen();
  try {
    const [me, submissions, stats, content, settings, outbox, analytics] = await Promise.all([
      api('/api/admin/me'), api('/api/admin/submissions'), api('/api/admin/stats'), api('/api/admin/content'),
      api('/api/admin/settings'), api('/api/admin/outbox'), api('/api/admin/analytics')
    ]);
    state.me = me.user;
    state.analytics = analytics;
    state.users = state.me.role === 'owner' ? (await api('/api/admin/users')).users : [];
    state.records = submissions.records || [];
    state.metrics = stats.metrics || [];
    state.content = content;
    state.settings = settings.settings || [];
    state.outbox = outbox;
    render();
  } catch { /* loginScreen already rendered */ }
}

/* ---------- Views ---------- */

function shell(inner) {
  const pending = state.metrics.filter((metric) => !metric.signedOff).length;
  const undelivered = state.outbox.messages.filter((message) => message.status !== 'sent').length;
  const nav = [['dashboard', 'Dashboard', ''], ['submissions', 'Submissions', state.records.length], ['stats', 'Public stats', pending || ''],
    ...Object.entries(collections).map(([key, config]) => [key, config.label, state.content[key].length]),
    ['settings', 'Community links', ''], ['outbox', 'Outbox', undelivered || ''], ['analytics', 'Analytics', ''],
    ...(state.me?.role === 'owner' ? [['users', 'Accounts', state.users.length]] : [])];
  return `<div class="admin-shell">
    <nav class="admin-nav">${nav.map(([key, label, count]) => `<button data-view="${key}" class="${state.view === key ? 'on' : ''}">${esc(label)}${count === '' ? '' : ` <b>${esc(count)}</b>`}</button>`).join('')}
      <div class="admin-whoami"><b>${esc(state.me?.name || '')}</b><span>${esc(state.me?.role || '')}</span></div>
      <button class="admin-signout" id="signOut">Sign out</button></nav>
    <div class="admin-panel">${inner}</div></div>`;
}

function dashboard() {
  const pending = state.metrics.filter((metric) => !metric.signedOff);
  const count = (type) => state.records.filter((record) => record.type === type).length;
  const unpublished = (key) => state.content[key].filter((item) => item[collections[key].stateKey] !== (key === 'partners' ? 'Confirmed' : 'Published'));
  const attention = [
    pending.length && { label: `${pending.length} public ${pending.length === 1 ? 'figure' : 'figures'} waiting for sign-off`, detail: pending.map((metric) => metric.label).join(', ') + ' — rendering as an em dash until an owner signs off.', view: 'stats', action: 'Open the sign-off queue' },
    count('Partner enquiry') && { label: `${count('Partner enquiry')} partner ${count('Partner enquiry') === 1 ? 'enquiry' : 'enquiries'} to answer`, detail: 'The partnerships lead replies within five working days.', view: 'submissions', action: 'Open submissions' },
    count('Program application') && { label: `${count('Program application')} program ${count('Program application') === 1 ? 'application' : 'applications'} in the queue`, detail: 'Two reviewers each; every applicant gets a decision, including the no\'s.', view: 'submissions', action: 'Open submissions' },
    unpublished('events').length && { label: `${unpublished('events').length} events not published`, detail: unpublished('events').map((item) => item.title).join(', ') + ' — invisible to the public until a date and venue are set.', view: 'events', action: 'Open events' },
    unpublished('posts').length && { label: `${unpublished('posts').length} posts in draft or review`, detail: unpublished('posts').map((item) => item.title).join(', '), view: 'posts', action: 'Open blog posts' },
    unpublished('partners').length && { label: `${unpublished('partners').length} partner agreements unsigned`, detail: 'The public partners grid stays in its empty state until one is countersigned.', view: 'partners', action: 'Open partners' }
  ].filter(Boolean);
  return `<section class="admin-head"><div><p class="eyebrow">CONTENT CONTROL · SERVER MODE</p><h1>Good morning,<br /><em>operator.</em></h1></div>
      <p>Everything here writes to the local server. Publish state and stat sign-off decide what the public pages show.</p></section>
    <section class="admin-stats">
      <article><span>CORE SIGNUPS</span><b>${count('Core signup')}</b></article>
      <article><span>PROGRAM APPLICATIONS</span><b>${count('Program application')}</b></article>
      <article><span>PARTNER ENQUIRIES</span><b>${count('Partner enquiry')}</b></article>
      <article><span>UNVERIFIED CLAIMS</span><b class="${pending.length ? 'warn' : ''}">${String(pending.length).padStart(2, '0')}</b></article>
    </section>
    <section class="submission-panel"><div class="panel-title"><div><p class="eyebrow">NEEDS YOUR ATTENTION</p><h2>${attention.length} item${attention.length === 1 ? '' : 's'}</h2></div></div>
      ${attention.length ? `<div class="attention-list">${attention.map((item) => `<article><div><h3>${esc(item.label)}</h3><p>${esc(item.detail)}</p></div><button class="arrow-link" data-view="${item.view}">${esc(item.action)} <span>→</span></button></article>`).join('')}</div>`
      : '<div class="admin-empty"><span>◇</span><h3>Nothing waiting.</h3><p>Every figure is signed off and every item is published.</p></div>'}</section>`;
}

function submissions() {
  const types = ['All', 'Core signup', 'Program application', 'Contact message', 'Partner enquiry', 'Newsletter signup'];
  const shown = state.filter === 'All' ? state.records : state.records.filter((record) => record.type === state.filter);
  const detail = (record) => [record.track, record.interest, record.topic, record.organisation, record.support, record.outcome, record.idea].filter(Boolean).join(' · ');
  return `<section class="panel-head"><div><p class="eyebrow">INCOMING</p><h2>Submissions</h2><p class="muted">Every public form writes here. Applications, partner enquiries and newsletter signups share one queue.</p></div>
      <button class="button button-quiet" id="clearRecords" ${state.records.length ? '' : 'disabled'}>Clear server records</button></section>
    <div class="filter-bar">${types.map((type) => `<button class="chip" data-adminfilter="${esc(type)}" aria-pressed="${state.filter === type}">${esc(type)} <b>${type === 'All' ? state.records.length : state.records.filter((record) => record.type === type).length}</b></button>`).join('')}</div>
    ${shown.length ? `<div class="records">${shown.map((record) => `<article><div><p class="tag">${esc(record.type)}</p><h3>${esc(record.name || record.organisation || 'Anonymous')}</h3><p>${esc(record.email || 'No email')} · ${when(record.createdAt)}</p></div>
      <div><b>${esc(record.id)}</b><p>${esc(detail(record))}</p></div></article>`).join('')}</div>`
    : `<div class="admin-empty"><span>◇</span><h3>Nothing in this queue.</h3><p>Use the public Join Core, application, partnership or newsletter forms to generate records here.</p></div>`}`;
}

function statsView() {
  return `<section class="panel-head"><div><p class="eyebrow">PUBLIC STAT SIGN-OFF</p><h2>Every figure needs<br />a source and an owner.</h2>
      <p class="muted">A metric without sign-off renders as an em dash on the public site with “audit in progress”. This is deliberate: no number goes out that we cannot defend.</p></div></section>
    <div class="stat-rows">${state.metrics.map((metric) => `<form class="stat-row${metric.signedOff ? '' : ' pending'}" data-metric="${esc(metric.key)}">
      <div class="stat-label"><h3>${esc(metric.label)}</h3><p>${esc(metric.usedOn)}</p><small>Last change ${when(metric.updatedAt)}</small></div>
      <label>Value<input name="value" value="${esc(metric.value)}" placeholder="—" /></label>
      <label>Source<input name="source" value="${esc(metric.source)}" /></label>
      <div class="stat-actions"><span class="status-line"><span class="dot ${metric.signedOff ? 'tone-ok' : 'tone-warm'}"></span>${metric.signedOff ? 'Signed off' : 'Pending'}</span>
        <button class="button button-quiet" type="submit" name="intent" value="save">Save</button>
        <button class="button" type="submit" name="intent" value="${metric.signedOff ? 'withdraw' : 'signoff'}">${metric.signedOff ? 'Withdraw' : 'Sign off'}</button></div>
      <p class="form-note"></p></form>`).join('')}</div>`;
}

function editor(key, item) {
  const config = collections[key];
  const isNew = !item;
  const value = (field) => esc((item || {})[field] || '');
  return `<form class="content-editor" data-editor="${key}" data-slug="${esc((item || {}).slug || '')}">
    <div class="editor-head"><p class="tag">${isNew ? 'NEW' : 'EDITING'} · ${esc(config.label).toUpperCase()}</p><h3>${isNew ? config.action : esc(item.title || item.name)}</h3></div>
    ${isNew ? `<label>URL slug<input name="slug" placeholder="left blank, generated from the title" /></label>` : ''}
    ${config.fields.map(([field, label, type]) => {
      if (type === 'textarea') return `<label class="wide">${esc(label)}<textarea name="${field}">${value(field)}</textarea></label>`;
      if (type === 'image') return `<div class="image-field wide"><span class="image-label">${esc(label)}</span>
        <div class="image-row">
          <div class="image-preview">${value(field) ? `<img src="${value(field)}" alt="" />` : '<span>No image</span>'}</div>
          <div class="image-actions">
            <input type="file" accept="image/png,image/jpeg,image/webp" data-image-for="${field}" id="file-${field}" />
            <label class="button button-quiet" for="file-${field}">Choose image <span>↑</span></label>
            ${value(field) ? `<button class="button button-quiet" type="button" data-clear-image="${field}">Remove</button>` : ''}
            <p class="image-note">PNG, JPEG or WebP. Downscaled to 900px before upload.</p>
          </div>
        </div>
        <input type="hidden" name="${field}" value="${value(field)}" /></div>`;
      return `<label>${esc(label)}<input name="${field}" value="${value(field)}" /></label>`;
    }).join('')}
    <label>Status<select name="${config.stateKey}">${config.states.map((option) => `<option${(item || {})[config.stateKey] === option ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select></label>
    <div class="editor-actions">
      <button class="button" type="submit">${isNew ? 'Create' : 'Save changes'} <span>→</span></button>
      <button class="button button-quiet" type="button" data-cancel>Cancel</button>
      ${isNew ? '' : `<button class="button button-quiet danger" type="button" data-delete>Delete</button>`}
    </div>
    <p class="form-note"></p></form>`;
}

function table(key) {
  const config = collections[key];
  const items = state.content[key];
  const filters = ['All', ...config.states];
  const shown = state.filter === 'All' ? items : items.filter((item) => item[config.stateKey] === state.filter);
  if (state.editing && state.editing.key === key) return editor(key, state.editing.slug ? items.find((item) => item.slug === state.editing.slug) : null);
  return `<section class="panel-head"><div><p class="eyebrow">${esc(config.label).toUpperCase()}</p><h2>${esc(config.label)}</h2><p class="muted">${esc(config.note)}</p></div>
      <button class="button button-quiet" data-new="${key}">${esc(config.action)} <span>+</span></button></section>
    <div class="filter-bar">${filters.map((filter) => `<button class="chip" data-adminfilter="${esc(filter)}" aria-pressed="${state.filter === filter}">${esc(filter)} <b>${filter === 'All' ? items.length : items.filter((item) => item[config.stateKey] === filter).length}</b></button>`).join('')}</div>
    ${shown.length ? `<div class="admin-table"><div class="admin-row head">${config.columns.map((column) => `<span>${esc(column)}</span>`).join('')}<span></span></div>
      ${shown.map((item) => { const cells = config.cells(item); const status = item[config.stateKey];
        return `<div class="admin-row"><div><b>${esc(cells[0][0])}</b><small>${esc(cells[0][1] || '')}</small></div><span>${esc(cells[1] || '—')}</span><span>${esc(cells[2] || '—')}</span>
        <span class="status-line"><span class="dot tone-${tone[status] || 'muted'}"></span>${esc(status)}</span>
        <span><button class="arrow-link" data-edit="${key}" data-slug="${esc(item.slug)}">Edit</button></span></div>`; }).join('')}</div>`
      : `<div class="admin-empty"><span>◇</span><h3>Nothing with that status.</h3><p>Change the filter, or add a new item.</p></div>`}`;
}

function settingsView() {
  const rooms = state.settings.filter((entry) => entry.url);
  return `<section class="panel-head"><div><p class="eyebrow">COMMUNITY LINKS &amp; INBOXES</p><h2>Where people land,<br />and who hears about it.</h2>
      <p class="muted">The join flow ends by handing new members straight into these rooms. Leave a field blank and the flow says the invite is coming by email rather than showing a dead link — no room goes public before it exists.</p></div></section>
    <form class="stat-rows" id="settingsForm">${state.settings.map((entry) => `<div class="stat-row${entry.url && !entry.value ? ' pending' : ''}">
      <div class="stat-label"><h3>${esc(entry.label)}</h3><p>${esc(entry.hint)}</p></div>
      <label class="stat-wide">Value<input name="${esc(entry.key)}" value="${esc(entry.value)}" placeholder="${entry.url ? 'https://…' : 'name@synthavia.ai'}" /></label>
      <div class="stat-actions"><span class="status-line"><span class="dot ${entry.value ? 'tone-ok' : 'tone-warm'}"></span>${entry.value ? 'Set' : 'Not set'}</span></div>
    </div>`).join('')}
    <div class="editor-actions"><button class="button" type="submit">Save links <span>→</span></button></div>
    <p class="form-note"></p></form>
    ${rooms.every((entry) => !entry.value) ? '<p class="honesty"><span>⌁</span> No rooms are configured, so every new Core member currently ends the flow without a place to go. This is the one setting worth filling in first.</p>' : ''}`;
}

function outboxView() {
  const messages = state.outbox.messages;
  const undelivered = messages.filter((message) => message.status !== 'sent').length;
  const tone = { sent: 'ok', queued: 'warm', failed: 'warm' };
  return `<section class="panel-head"><div><p class="eyebrow">OUTBOX</p><h2>Every email the site<br />tried to send.</h2>
      <p class="muted">${state.outbox.configured
        ? 'An email endpoint is configured, so messages are delivered as they are created. Anything that failed stays here and can be retried.'
        : 'No email endpoint is configured, so nothing has actually been delivered — every message is held here instead of being lost. Set SYNTHAVIA_EMAIL_ENDPOINT and SYNTHAVIA_EMAIL_KEY, then retry.'}</p></div>
      <div class="outbox-actions">
        <button class="button button-quiet" id="retryOutbox" ${state.outbox.configured && undelivered ? '' : 'disabled'}>Retry ${undelivered} undelivered <span>→</span></button>
        <!-- Never disabled: pressing it when no key is set is how you find out that no key is set. -->
        <button class="button" id="testEmail">Send a test email <span>→</span></button>
      </div></section>
    ${state.outbox.from ? `<p class="muted outbox-from">Sending as <code>${esc(state.outbox.from)}</code>. That domain has to be verified with your email provider or every send is rejected — a Gmail address can never be the sender.</p>` : ''}
    <p class="form-note" id="testEmailNote"></p>
    ${messages.length ? `<div class="records">${messages.slice(0, 60).map((message) => `<article><div><p class="tag">${esc(message.to)}</p><h3>${esc(message.subject)}</h3><p>${when(message.createdAt)} · ${message.attempts} attempt${message.attempts === 1 ? '' : 's'}</p></div>
      <div><span class="status-line"><span class="dot tone-${tone[message.status] || 'muted'}"></span>${esc(message.status)}</span><p>${esc(message.error || '')}</p></div></article>`).join('')}</div>`
      : '<div class="admin-empty"><span>◇</span><h3>No mail yet.</h3><p>Submit a form on the public site and both the acknowledgement and the team notification appear here.</p></div>'}`;
}

function usersView() {
  return `<section class="panel-head"><div><p class="eyebrow">ACCOUNTS</p><h2>Who can sign in.</h2>
      <p class="muted">Owners manage accounts and sign off public figures. Editors can change content but cannot publish a number. Passwords are hashed with scrypt; nobody — including an owner — can read another account's password.</p></div></section>
    <div class="admin-table"><div class="admin-row head"><span>Person</span><span>Role</span><span>Last sign-in</span><span></span></div>
      ${state.users.map((person) => `<div class="admin-row user-row">
        <div><b>${esc(person.name)}</b><small>${esc(person.email)}</small></div>
        <span class="status-line"><span class="dot tone-${person.role === 'owner' ? 'ok' : 'cyan'}"></span>${esc(person.role)}</span>
        <span>${when(person.lastLogin)}</span>
        <span>${person.id === state.me.id ? '<small>you</small>' : `<button class="arrow-link" data-remove-user="${esc(person.id)}">Remove</button>`}</span>
      </div>`).join('')}</div>
    <form class="content-editor" id="newUser">
      <div class="editor-head"><p class="tag">NEW</p><h3>Add an account</h3></div>
      <label>Name<input name="name" /></label>
      <label>Email<input required type="email" name="email" /></label>
      <label>Password (12+ characters)<input required type="password" name="password" minlength="12" /></label>
      <label>Role<select name="role"><option value="editor">Editor</option><option value="owner">Owner</option></select></label>
      <div class="editor-actions"><button class="button" type="submit">Create account <span>→</span></button></div>
      <p class="form-note"></p></form>`;
}

function analyticsView() {
  const data = state.analytics || { total: 0, pages: [], referrers: [], daily: [] };
  const peak = Math.max(1, ...data.daily.map((day) => day.views));
  return `<section class="panel-head"><div><p class="eyebrow">ANALYTICS · LAST 30 DAYS</p><h2>${data.total.toLocaleString()} page views.</h2>
      <p class="muted">Counted on the server: a path, a day and the referring site. No cookies, no identifiers, no IP addresses — nothing that could single out a visitor, so there is nothing to disclose in the privacy note beyond what it already says.</p></div></section>
    ${data.daily.length ? `<div class="spark">${data.daily.map((day) => `<span style="height:${Math.max(3, Math.round(day.views / peak * 100))}%" title="${esc(day.day)}: ${day.views}"></span>`).join('')}</div>` : ''}
    <div class="analytics-grid">
      <div class="fact-card"><p class="tag">TOP PAGES</p>${data.pages.length ? `<dl class="channel-list">${data.pages.map((row) => `<div><dt>${esc(row.path)}</dt><dd>${row.views}</dd></div>`).join('')}</dl>` : '<p class="muted">No views recorded yet.</p>'}</div>
      <div class="fact-card"><p class="tag">REFERRERS</p>${data.referrers.length ? `<dl class="channel-list">${data.referrers.map((row) => `<div><dt>${esc(row.referrer)}</dt><dd>${row.views}</dd></div>`).join('')}</dl>` : '<p class="muted">No external referrers yet — direct visits only.</p>'}</div>
    </div>
    ${state.me?.role === 'owner' ? '<div class="editor-actions"><button class="button button-quiet" id="backupNow">Back up the database now <span>↓</span></button><p class="form-note" id="backupNote"></p></div>' : ''}`;
}

function render() {
  const views = { dashboard, submissions, stats: statsView, settings: settingsView, outbox: outboxView, users: usersView, analytics: analyticsView };
  const inner = views[state.view] ? views[state.view]() : table(state.view);
  main.innerHTML = shell(inner);
  document.querySelector('#signOut')?.addEventListener('click', async () => {
    try { await api('/api/admin/logout', { method: 'POST' }); } catch {}
    sessionStorage.removeItem(adminTokenKey);
    loginScreen('Signed out.');
  });
  document.querySelector('#clearRecords')?.addEventListener('click', async () => { await api('/api/admin/submissions', { method: 'DELETE' }); load(); });
  document.querySelector('#retryOutbox')?.addEventListener('click', async (event) => { event.target.disabled = true; await api('/api/admin/outbox', { method: 'POST' }); load(); });
  document.querySelector('#testEmail')?.addEventListener('click', async (event) => {
    const note = document.querySelector('#testEmailNote');
    const recipient = window.prompt('Send a test email to:', state.me?.email || '');
    if (!recipient) return;
    event.target.disabled = true;
    note.textContent = `Sending to ${recipient}…`;
    // The provider's own error is shown rather than a generic failure: it is the only thing that
    // says whether the key is wrong, the domain unverified, or the address simply a typo.
    try {
      const result = await api('/api/admin/email-test', { method: 'POST', body: JSON.stringify({ email: recipient }) });
      note.textContent = result.sent ? `Sent to ${result.to}. Check the inbox, and the spam folder.` : `Not sent — ${result.error}`;
    } catch (error) {
      note.textContent = `Not sent — ${error.message}`;
    }
    event.target.disabled = false;
    load();
  });
  document.querySelector('#backupNow')?.addEventListener('click', async (event) => {
    event.target.disabled = true;
    try { const r = await api('/api/admin/backup', { method: 'POST' }); document.querySelector('#backupNote').textContent = `Saved ${r.file} (${Math.round(r.bytes / 1024)} KB). ${r.kept} kept.`; }
    catch (error) { document.querySelector('#backupNote').textContent = error.message; }
    event.target.disabled = false;
  });
}

/* ---------- Interaction ---------- */

main.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]');
  if (view) { state.view = view.dataset.view; state.filter = 'All'; state.editing = null; return render(); }
  const filter = event.target.closest('[data-adminfilter]');
  if (filter) { state.filter = filter.dataset.adminfilter; return render(); }
  const edit = event.target.closest('[data-edit]');
  if (edit) { state.editing = { key: edit.dataset.edit, slug: edit.dataset.slug }; return render(); }
  const create = event.target.closest('[data-new]');
  if (create) { state.editing = { key: create.dataset.new, slug: '' }; return render(); }
  if (event.target.closest('[data-cancel]')) { state.editing = null; return render(); }
  const clear = event.target.closest('[data-clear-image]');
  if (clear) {
    const form = clear.closest('[data-editor]');
    form.querySelector(`input[type="hidden"][name="${clear.dataset.clearImage}"]`).value = '';
    form.querySelector('.image-preview').innerHTML = '<span>No image</span>';
    clear.remove();
    form.querySelector('.form-note').textContent = 'Image removed. Save to apply.';
    return;
  }
  const removeUser = event.target.closest('[data-remove-user]');
  if (removeUser) {
    if (!window.confirm('Remove this account? They will be signed out immediately.')) return;
    try { await api('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ id: removeUser.dataset.removeUser }) }); load(); }
    catch (error) { window.alert(error.message); }
    return;
  }
  const remove = event.target.closest('[data-delete]');
  if (remove) {
    const form = remove.closest('[data-editor]');
    // One confirmation: deleting content is not recoverable from this prototype's store.
    if (!window.confirm('Delete this item permanently?')) return;
    try {
      await api('/api/admin/content', { method: 'DELETE', body: JSON.stringify({ collection: form.dataset.editor, slug: form.dataset.slug }) });
      state.editing = null;
      load();
    } catch (error) { form.querySelector('.form-note').textContent = error.message; }
  }
});

// Downscale in the browser: a 4MB phone photo becomes ~150KB before it ever leaves the machine,
// which keeps the upload fast on a slow connection and the served page light.
function downscale(file, max = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('That file is not a readable image.'));
      image.onload = () => {
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        // PNG keeps transparency; everything else is smaller as JPEG.
        const asPng = file.type === 'image/png';
        resolve(canvas.toDataURL(asPng ? 'image/png' : 'image/jpeg', asPng ? undefined : 0.86));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

main.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-image-for]');
  if (!input || !input.files?.length) return;
  const field = input.dataset.imageFor;
  const form = input.closest('[data-editor]');
  const note = form.querySelector('.form-note');
  const preview = form.querySelector('.image-preview');
  note.textContent = 'Uploading…';
  try {
    const data = await downscale(input.files[0]);
    const result = await api('/api/admin/media', { method: 'POST', body: JSON.stringify({ name: input.files[0].name.replace(/\.[^.]+$/, ''), data }) });
    form.querySelector(`input[type="hidden"][name="${field}"]`).value = result.url;
    preview.innerHTML = `<img src="${result.url}" alt="" />`;
    note.textContent = `Uploaded (${Math.round(result.bytes / 1024)} KB). Save to keep it.`;
  } catch (error) {
    note.textContent = error.message || 'Upload failed.';
  } finally {
    input.value = '';
  }
});

main.addEventListener('submit', async (event) => {
  const metricForm = event.target.closest('[data-metric]');
  if (metricForm) {
    event.preventDefault();
    const intent = event.submitter?.value || 'save';
    const metric = state.metrics.find((entry) => entry.key === metricForm.dataset.metric);
    const value = metricForm.querySelector('[name="value"]').value.trim();
    const note = metricForm.querySelector('.form-note');
    if (intent === 'signoff' && !value) { note.textContent = 'Give the figure a value before signing it off.'; return; }
    try {
      const result = await api('/api/admin/stats', { method: 'POST', body: JSON.stringify({ key: metricForm.dataset.metric, value, source: metricForm.querySelector('[name="source"]').value, signedOff: intent === 'signoff' ? true : intent === 'withdraw' ? false : metric.signedOff }) });
      Object.assign(metric, result.metric);
      render();
    } catch (error) { note.textContent = error.message; }
    return;
  }
  if (event.target.closest('#newUser')) {
    event.preventDefault();
    const form = event.target.closest('#newUser');
    const note = form.querySelector('.form-note');
    try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); load(); }
    catch (error) { note.textContent = error.message; }
    return;
  }
  if (event.target.closest('#settingsForm')) {
    event.preventDefault();
    const form = event.target.closest('#settingsForm');
    const note = form.querySelector('.form-note');
    try {
      await api('/api/admin/settings', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      load();
    } catch (error) { note.textContent = error.message; }
    return;
  }
  const editorForm = event.target.closest('[data-editor]');
  if (!editorForm) return;
  event.preventDefault();
  const note = editorForm.querySelector('.form-note');
  const payload = { collection: editorForm.dataset.editor, slug: editorForm.dataset.slug };
  new FormData(editorForm).forEach((value, key) => { if (key !== 'slug' || !payload.slug) payload[key] = value; });
  try {
    await api('/api/admin/content', { method: 'POST', body: JSON.stringify(payload) });
    state.editing = null;
    load();
  } catch (error) { note.textContent = error.message; }
});

load();
