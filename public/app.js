// Shared behaviour for every public page: theme, language, forms, toasts and the signed-off stats bar.
const body = document.body;
const toast = document.querySelector('#toast');

/* ---------- Theme ---------- */

// Controls exist in the header and again inside the mobile sheet, so both are driven by attribute.
function applyTheme(theme) {
  body.classList.toggle('light', theme === 'light');
  document.querySelectorAll('[data-theme-cycle]').forEach((control) => {
    control.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`);
    control.querySelector('.theme-icon').textContent = theme === 'light' ? '☼' : '◐';
  });
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-theme-cycle]')) return;
  const theme = body.classList.contains('light') ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('sy-theme', theme); } catch {}
});

/* ---------- Mobile navigation ---------- */
// Eight links fit a sheet; the header row does not. Built from the header nav so it cannot drift from it.

const navToggle = document.querySelector('#navToggle');
const headerNav = document.querySelector('.site-header nav');
let sheet = null;

if (navToggle && headerNav) {
  sheet = document.createElement('div');
  sheet.className = 'nav-sheet';
  sheet.id = 'navSheet';
  sheet.setAttribute('inert', '');
  // The label keeps its own data-i18n element: translate() replaces innerHTML, so the number must sit outside it.
  const links = [...headerNav.querySelectorAll('a')].map((link, index) => {
    const key = link.dataset.i18n ? ` data-i18n="${link.dataset.i18n}"` : '';
    return `<a class="sheet-link" href="${link.getAttribute('href')}"><span${key}>${link.textContent}</span><span class="sheet-index">${String(index + 1).padStart(2, '0')}</span></a>`;
  }).join('');
  const cta = document.querySelector('.header-actions .button-small');
  sheet.innerHTML = `<nav aria-label="Mobile navigation">${links}</nav>
    <div class="sheet-foot">
      <button class="text-button" data-lang-cycle aria-label="Switch language"><span class="lang-label">EN</span> <span>⌄</span></button>
      <button class="theme-toggle" data-theme-cycle aria-label="Switch theme"><span class="theme-icon">◐</span></button>
      ${cta ? `<a class="button" href="${cta.getAttribute('href')}"><span data-i18n="cta.join">Join Core</span> <span>↗</span></a>` : ''}
    </div>`;
  body.appendChild(sheet);
}

function setSheet(open) {
  if (!sheet) return;
  sheet.classList.toggle('open', open);
  body.classList.toggle('nav-open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  if (open) { sheet.removeAttribute('inert'); sheet.querySelector('a')?.focus(); }
  else { sheet.setAttribute('inert', ''); navToggle.focus(); }
}
navToggle?.addEventListener('click', () => setSheet(!sheet.classList.contains('open')));
sheet?.addEventListener('click', (event) => { if (event.target.closest('a')) setSheet(false); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && sheet?.classList.contains('open')) setSheet(false); });
// A sheet left open behind a widening viewport would trap the page under a scroll lock.
window.addEventListener('resize', () => { if (window.innerWidth > 800 && sheet?.classList.contains('open')) setSheet(false); });

try { applyTheme(localStorage.getItem('sy-theme') || 'dark'); } catch { applyTheme('dark'); }

/* ---------- Language ---------- */
// Pidgin and Igbo are working drafts pending native review, so only the hero and nav are translated.

const phrases = {
  EN: { 'nav.about': 'About', 'nav.core': 'Core', 'nav.lab': 'Lab', 'nav.programs': 'Programs', 'nav.events': 'Events', 'nav.blog': 'Blog', 'nav.partners': 'Partners', 'nav.contact': 'Contact', 'cta.join': 'Join Core', 'hero.eyebrow': 'ABIA, NIGERIA · EST. 2025', 'hero.title': 'Building Africa\'s <em>AI future</em><br />from Abia.', 'hero.lede': 'We train the talent, run the research, and ship AI that works for African realities.', 'hero.explore': 'Explore the ecosystem', 'hero.research': 'See the research', 'hero.note': 'Nnoo. Welcome. Make we build am together.' },
  PCM: { 'nav.about': 'About Us', 'nav.core': 'Core', 'nav.lab': 'Lab', 'nav.programs': 'Programs', 'nav.events': 'Events', 'nav.blog': 'Blog', 'nav.partners': 'Partners', 'nav.contact': 'Talk to Us', 'cta.join': 'Join Core', 'hero.eyebrow': 'ABIA, NAIJA · SINCE 2025', 'hero.title': 'We dey build Africa <em>AI future</em><br />from Abia.', 'hero.lede': 'We dey train the people, do the research, and ship AI wey go work for how we dey live here.', 'hero.explore': 'Look the ecosystem', 'hero.research': 'See the research', 'hero.note': 'Nnoo. Welcome. Make we build am together.' },
  IG: { 'nav.about': 'Banyere Anyị', 'nav.core': 'Core', 'nav.lab': 'Ụlọ Nnyocha', 'nav.programs': 'Mmemme', 'nav.events': 'Ihe Omume', 'nav.blog': 'Blog', 'nav.partners': 'Ndị Mmekọ', 'nav.contact': 'Kpọtụrụ Anyị', 'cta.join': 'Sonye na Core', 'hero.eyebrow': 'ABIA, NAỊJIRIA · EST. 2025', 'hero.title': 'Na-ewu <em>ọdịnihu AI</em> Afrika<br />site na Abia.', 'hero.lede': 'Anyị na-azụ ndị mmadụ, na-eme nnyocha, ma na-ewu AI nke na-arụ ọrụ maka ndụ ndị Afrika.', 'hero.explore': 'Chọgharịa ekosistemu', 'hero.research': 'Hụ nnyocha ahụ', 'hero.note': 'Nnoo. Welcome. Ka anyị wuo ya ọnụ.' }
};
let language = 'EN';

function applyLanguage(next, announce) {
  language = phrases[next] ? next : 'EN';
  document.documentElement.lang = language === 'IG' ? 'ig' : 'en';
  document.querySelectorAll('.lang-label').forEach((label) => { label.textContent = language; });
  translate(document);
  try { localStorage.setItem('sy-lang', language); } catch {}
  if (!announce) return;
  showToast(language === 'EN' ? 'English selected.' : `${language === 'IG' ? 'Igbo' : 'Pidgin'} is a working draft — native review is pending before launch.`);
}
function translate(root) {
  root.querySelectorAll('[data-i18n]').forEach((element) => {
    const value = phrases[language][element.dataset.i18n];
    if (value !== undefined) element.innerHTML = value;
  });
}
try { applyLanguage(localStorage.getItem('sy-lang') || 'EN'); } catch { applyLanguage('EN'); }
document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-lang-cycle]')) return;
  const cycle = ['EN', 'PCM', 'IG'];
  applyLanguage(cycle[(cycle.indexOf(language) + 1) % cycle.length], true);
});

/* ---------- Currency ---------- */
// No face on this site carries U+20A6, and the donor's naira sign inks taller than Syne's short
// lining figures, so each one is tagged and scaled back wherever it sits in display type.

function markCurrency(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.nodeValue.includes('₦') && !node.parentElement?.closest('.naira, script, style')
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT
  });
  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);
  for (const node of targets) {
    const parts = node.nodeValue.split('₦');
    const fragment = document.createDocumentFragment();
    parts.forEach((part, index) => {
      if (index) {
        const mark = document.createElement('span');
        mark.className = 'naira';
        mark.textContent = '₦';
        fragment.appendChild(mark);
      }
      if (part) fragment.appendChild(document.createTextNode(part));
    });
    node.parentNode.replaceChild(fragment, node);
  }
}
markCurrency(document.body);

/* ---------- Toast ---------- */

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(window.toastTimer);
  window.toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4400);
}
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-toast]');
  if (trigger) showToast(trigger.dataset.toast);
});

/* ---------- Forms ---------- */

async function post(payload) {
  const response = await fetch('/api/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

// Every public form gets the honeypot injected, so no template has to remember it.
function armHoneypot(root = document) {
  root.querySelectorAll('form[data-form]').forEach((form) => {
    if (form.querySelector('input[name="company"]')) return;
    form.insertAdjacentHTML('afterbegin', `<div class="hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off" /></label></div>`);
  });
}
armHoneypot();
new MutationObserver(() => armHoneypot()).observe(document.body, { childList: true, subtree: true });

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const note = form.querySelector('.form-note');
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const consent = form.querySelector('input[name="consent"]');
  if (consent && !consent.checked) {
    if (note) note.textContent = 'Please confirm the logo-use note before sending.';
    return;
  }
  const payload = { type: form.dataset.form, support: data.getAll('support') };
  const alsoSubscribe = form.querySelector('input[name="newsletter"]')?.checked;
  data.forEach((value, key) => { if (!['support', 'consent', 'newsletter'].includes(key)) payload[key] = value; });
  if (form.dataset.source) payload.source = form.dataset.source;
  if (note) note.textContent = '';
  if (button) { button.disabled = true; button.dataset.label = button.innerHTML; button.textContent = 'Sending…'; }
  try {
    const result = await post(payload);
    if (payload.type === 'Partner enquiry') {
      form.innerHTML = `<div class="form-success"><p class="tag">✓ THANK YOU — THIS IS WITH OUR PARTNERSHIPS LEAD</p><h3>Reference ${result.id}</h3><p>Nothing goes public until you approve the wording and the agreement is countersigned. You will hear from us within five working days.</p><a class="arrow-link" href="/partners">Send another enquiry <span>→</span></a></div>`;
      return;
    }
    if (payload.type === 'Newsletter signup') {
      if (button) { button.disabled = true; button.textContent = 'Subscribed ✓'; }
      if (note) note.textContent = `You are on the list. Reference ${result.id}.`;
      form.querySelector('input[type="email"]')?.setAttribute('disabled', 'disabled');
      return;
    }
    // The opt-in is a second, separate record — consent to be messaged is not the same as
    // consent to be subscribed, and the admin should be able to see each on its own.
    if (alsoSubscribe && payload.email) {
      await post({ type: 'Newsletter signup', email: payload.email, source: 'Contact opt-in' }).catch(() => {});
    }
    showToast(`Thanks${payload.name ? `, ${payload.name}` : ''}. Reference ${result.id} is with the right team.${alsoSubscribe ? ' You are on the newsletter too.' : ''}`);
    form.reset();
  } catch (error) {
    if (note) note.textContent = error.message || 'That could not be saved.';
    else showToast(error.message || 'That could not be saved.');
  } finally {
    if (button && button.dataset.label && !button.textContent.includes('✓')) { button.disabled = false; button.innerHTML = button.dataset.label; }
  }
});

/* ---------- Signed-off public figures ---------- */

async function renderStats() {
  const bar = document.querySelector('#statsBar');
  const grid = document.querySelector('#impactGrid');
  if (!bar && !grid) return;
  try {
    const response = await fetch('/api/stats');
    const { metrics } = await response.json();
    // The top strip carries only what is proven; the impact grid shows the full accounting,
    // including what is still being audited and why.
    if (bar) {
      const proven = metrics.filter((metric) => metric.signedOff);
      bar.innerHTML = proven.length
        ? proven.map((metric) => `<article><b>${metric.value}</b><span>${metric.label}</span><small>${metric.source}</small></article>`).join('')
        : '<article class="pending"><b>—</b><span>No figure is signed off yet</span><small>Numbers appear here once an owner signs them off</small></article>';
    }
    if (grid) {
      grid.innerHTML = metrics.map((metric) => `<article${metric.signedOff ? '' : ' class="pending"'}><b>${metric.signedOff ? metric.value : '—'}</b><span>${metric.label}</span>
        <small>${metric.signedOff ? metric.source : `${metric.source} · audit in progress`}</small></article>`).join('');
    }
  } catch {
    const message = '<article class="pending"><b>—</b><span>Figures unavailable</span><small>The stats service is not reachable</small></article>';
    if (bar) bar.innerHTML = message;
    if (grid) grid.innerHTML = message;
  }
}
renderStats();

// A quote goes up only with a name and consent behind it, so the empty state is the honest default.
async function renderTestimonials() {
  const target = document.querySelector('#testimonials');
  if (!target) return;
  try {
    const { testimonials = [] } = await (await fetch('/api/content')).json();
    target.innerHTML = testimonials.length
      ? `<div class="quote-grid">${testimonials.map((item) => `<figure><blockquote>${item.quote}</blockquote><figcaption><b>${item.name}</b><span>${item.role}</span></figcaption></figure>`).join('')}</div>`
      : `<div class="empty-panel"><span>◌</span><div><p class="tag">NOTHING PUBLISHED YET</p><h3>No quotes are up yet.</h3>
          <p>We publish a member's words only with their name, their role and their permission. Approved quotes appear here — invented ones never will.</p></div>
          <a class="button button-quiet" href="/flow?type=join">Join Core <span>→</span></a></div>`;
    markCurrency(target);
  } catch { target.innerHTML = ''; }
}
renderTestimonials();

// The home page states a partner count in static markup; keep it honest against the content store.
async function renderHomePartners() {
  const block = document.querySelector('#homePartners');
  if (!block) return;
  try {
    const { partners = [] } = await (await fetch('/api/content')).json();
    if (!partners.length) return;
    block.classList.remove('partner-empty');
    block.classList.add('partner-empty', 'signed');
    block.innerHTML = `<span>◆</span><div><p class="tag">CURRENT PARTNERS</p><h3>${partners.length} signed.</h3>
      <p>${partners.map((partner) => partner.name).join(', ')} — each behind a countersigned agreement.</p></div>
      <span class="empty-count">${String(partners.length).padStart(2, '0')}</span>`;
    markCurrency(block);
  } catch { /* the static empty state is the safe default */ }
}
renderHomePartners();

window.SynthaviaApp = { showToast, translate, markCurrency };
