// Synthavia AI — application server. No third-party dependencies.
//
// Storage is Postgres (db.js); every write is a transaction. Static files are served only from
// public/, so server code and the content seed are unreachable over HTTP.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const notify = require('./notify.js');
const store = require('./db.js');

const root = __dirname;
const publicDir = path.join(root, 'public');
// The HTML templates live outside public/ deliberately. public/ is the static output directory on
// Vercel, and its CDN answers any file there before a rewrite is consulted — so an .html file in
// public/ is served raw, skipping this server and with it the share tags, the canonical URL and
// the view counter, silently. See README, "Why views/ is not inside public/".
const viewsDir = path.join(root, 'views');
const mediaDir = path.join(publicDir, 'media');
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const trustProxy = process.env.TRUST_PROXY === '1';
const sessionLife = 1000 * 60 * 60 * 8;
const backupHours = Number(process.env.SYNTHAVIA_BACKUP_HOURS || 6);

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };
const compressible = new Set(['.html', '.css', '.js', '.svg']);

const forms = {
  'Core signup': { prefix: 'SY', extra: { interest: 120 } },
  'Program application': { prefix: 'SY', extra: { track: 200, idea: 1000 }, requires: ['idea'] },
  'Contact message': { prefix: 'SY', extra: { topic: 120, idea: 1000 } },
  'Partner enquiry': { prefix: 'PTR', extra: { organisation: 160, orgType: 80, role: 120, website: 200, tier: 60, support: 300, outcome: 1000 }, requires: ['organisation', 'outcome'] },
  'Newsletter signup': { prefix: 'SY', extra: { source: 60 }, anonymous: true }
};

const seedStats = [
  { key: 'members', label: 'Community members', usedOn: 'Home stats bar, impact grid', value: '1,240', source: 'Roster export, Sep 2026', signedOff: true },
  { key: 'editions', label: 'AI of Things editions', usedOn: 'Home stats bar', value: '2', source: 'Event records', signedOff: true },
  { key: 'projects', label: 'Lab projects running', usedOn: 'Home stats bar, Lab index', value: '3', source: 'Project register, Sep 2026', signedOff: true },
  { key: 'trained', label: 'Talents trained', usedOn: 'Impact grid', value: '', source: 'Attendance audit incomplete', signedOff: false },
  { key: 'partners', label: 'Partner organisations', usedOn: 'Impact grid, partners strip', value: '', source: 'No signed MOU', signedOff: false }
];
const seedSettings = [
  { key: 'whatsapp', label: 'WhatsApp community room', hint: 'Invite link — https://chat.whatsapp.com/…', value: '', url: true },
  { key: 'github', label: 'GitHub organisation', hint: 'https://github.com/…', value: '', url: true },
  { key: 'teamEmail', label: 'General inbox', hint: 'Where contact messages are notified', value: 'hello@synthavia.ai' },
  { key: 'programsEmail', label: 'Programs inbox', hint: 'Applications and Core signups', value: 'programs@synthavia.ai' },
  { key: 'partnersEmail', label: 'Partnerships inbox', hint: 'Partner enquiries', value: 'partners@synthavia.ai' }
];

const collections = {
  events: { fields: { title: 160, subtitle: 160, date: 60, startsAt: 20, venue: 160, format: 80, blurb: 600, badge: 60 }, states: ['Published', 'Draft'] },
  posts: { fields: { title: 200, dek: 400, category: 60, date: 30, read: 20, author: 120, initials: 4 }, states: ['Published', 'In review', 'Draft'] },
  partners: { fields: { name: 160, note: 200, tier: 60, owner: 120 }, states: ['Confirmed', 'Unsigned', 'Verbal'], stateKey: 'agreement' },
  projects: { fields: { title: 160, status: 80, metric: 40, metricLabel: 200, result: 400 }, states: ['Published', 'Draft'] },
  resources: { fields: { title: 160, kind: 40, detail: 300, url: 300 }, states: ['Published', 'Draft'] },
  testimonials: { fields: { quote: 400, name: 120, role: 160 }, states: ['Published', 'Draft'] },
  programs: { fields: { title: 160, kicker: 60, state: 60, body: 600, dur: 40, size: 40, mode: 60, cost: 60, dates: 160, action: 60 }, states: ['Published', 'Draft'] },
  team: { fields: { name: 120, role: 120, bio: 600, photo: 300, link: 300, order: 4 }, states: ['Published', 'Draft'] }
};
const staticLists = ['tiers', 'spend', 'orgTypes', 'supportKinds', 'topics', 'faqs'];

/* ---------- Helpers ---------- */

function respond(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}
function readBody(request, limit = 20_000) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.on('data', (chunk) => { value += chunk; if (value.length > limit) reject(new Error('Request is too large.')); });
    request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('Invalid JSON.')); } });
  });
}
function safeText(value, limit = 500) { return String(Array.isArray(value) ? value.join(', ') : value ?? '').trim().slice(0, limit); }
function slugify(value) { return safeText(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]); }
function origin(request) {
  const proto = trustProxy ? (request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : 'http';
  return `${proto}://${request.headers.host}`;
}
// Behind a proxy the socket address is the proxy's; the first forwarded hop is the visitor.
function clientIp(request) {
  if (trustProxy && request.headers['x-forwarded-for']) return String(request.headers['x-forwarded-for']).split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

/* ---------- Rate limiting ---------- */
// Counted in the database rather than in memory: serverless instances do not share state, so an
// in-process counter would reset on every cold start and let a flood straight through.

const budgets = {
  // Tunable so a load test or a shared office NAT does not need a code change.
  submit: { limit: Number(process.env.SYNTHAVIA_RATE_SUBMIT || 5), window: 10 * 60_000, message: 'Too many submissions from this connection. Please wait a few minutes.' },
  login: { limit: Number(process.env.SYNTHAVIA_RATE_LOGIN || 8), window: 15 * 60_000, message: 'Too many sign-in attempts. Please wait 15 minutes.' },
  media: { limit: 30, window: 60 * 60_000, message: 'Too many uploads. Please wait.' },
  api: { limit: 600, window: 5 * 60_000, message: 'Too many requests.' }
};
async function rateLimited(bucket, ip) {
  const budget = budgets[bucket];
  try {
    const used = await store.rateCount(bucket, ip, budget.window);
    return used >= budget.limit ? budget.message : null;
  } catch (error) {
    // A limiter that cannot reach the database must not take the site down with it.
    console.error('Rate limit check failed:', error.message);
    return null;
  }
}

/* ---------- Content ---------- */

async function content() {
  const all = {};
  for (const name of Object.keys(collections)) all[name] = await store.collection(name);
  for (const name of staticLists) all[name] = await store.contentStatic(name);
  return all;
}
async function publicContent() {
  const all = await content();
  return {
    ...all,
    events: all.events.filter((item) => item.status_publish === 'Published'),
    posts: all.posts.filter((item) => item.status_publish === 'Published'),
    projects: all.projects.filter((item) => item.status_publish === 'Published'),
    resources: all.resources.filter((item) => item.status_publish === 'Published'),
    testimonials: all.testimonials.filter((item) => item.status_publish === 'Published'),
    programs: all.programs.filter((item) => item.status_publish === 'Published'),
    team: all.team.filter((item) => item.status_publish === 'Published').sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99)),
    partners: all.partners.filter((item) => item.agreement === 'Confirmed')
  };
}
async function settings() {
  const saved = await store.settingsRaw();
  return seedSettings.map((entry) => ({ ...entry, value: saved[entry.key] ?? entry.value }));
}
async function settingsMap() { return Object.fromEntries((await settings()).map((entry) => [entry.key, entry.value])); }

/* ---------- Auth ---------- */

async function currentUser(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  return token ? store.sessionUser(token) : null;
}

/* ---------- Uploads ---------- */

const imageSignatures = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9 },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
];
// Vercel's filesystem is read-only, so uploads go to Supabase Storage when it is configured.
// Locally, with no Supabase credentials, they fall back to disk so development needs no account.
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const remoteStorage = Boolean(supabaseUrl && supabaseKey);

async function saveImage(input) {
  const match = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(input.data || ''));
  if (!match) throw new Error('Send the image as a base64 data URL.');
  const buffer = Buffer.from(match[1], 'base64');
  if (!buffer.length) throw new Error('That file is empty.');
  if (buffer.length > 4_000_000) throw new Error('Images must be 4MB or smaller.');
  const kind = imageSignatures.find((signature) => signature.test(buffer));
  if (!kind) throw new Error('Only PNG, JPEG and WebP images are accepted.');
  const name = `${slugify(input.name || 'image') || 'image'}-${crypto.randomBytes(4).toString('hex')}.${kind.ext}`;

  if (!remoteStorage) {
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, name), buffer);
    return { url: `/media/${name}`, bytes: buffer.length, storage: 'disk' };
  }
  const target = `uploads/${name}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${storageBucket}/${target}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      'Content-Type': kind.ext === 'png' ? 'image/png' : kind.ext === 'webp' ? 'image/webp' : 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable'
    },
    body: buffer
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}). Check the bucket name and service role key.`);
  return { url: `${supabaseUrl}/storage/v1/object/public/${storageBucket}/${target}`, bytes: buffer.length, storage: 'supabase' };
}

/* ---------- Submissions ---------- */

async function buildEntry(input) {
  const type = safeText(input.type, 60);
  const form = forms[type];
  if (!form) throw new Error('That form type is not recognised.');
  // Honeypot: a field hidden from people and irresistible to bots.
  if (safeText(input.company, 100)) throw new Error('This submission looks automated.');
  const email = safeText(input.email, 160).toLowerCase();
  const name = safeText(input.name, 120);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please provide an email address we can reach you on.');
  if (!name && !form.anonymous) throw new Error('Please provide your name.');
  if (await store.recentDuplicate(type, email)) throw new Error('We already have that one — give us a moment to read it.');
  const entry = { id: `${form.prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, createdAt: new Date().toISOString(), type, name, email };
  for (const [field, limit] of Object.entries(form.extra)) entry[field] = safeText(input[field], limit);
  for (const field of form.requires || []) if (!entry[field]) throw new Error('Please complete the required fields.');
  return entry;
}

/* ---------- Routes ---------- */

// The site has readable paths — /programs, /blog/<slug> — rather than query strings. view.html is
// the single shell behind all of the section pages, so a path is resolved to a page here and the
// client router derives the same thing from location.pathname. Keep the two in step: sections and
// detailOf below are mirrored at the top of public/view.js.
const sections = ['team', 'core', 'lab', 'programs', 'events', 'blog', 'partners', 'contact'];
const detailOf = { lab: 'case', blog: 'post', events: 'event' };
const standalone = { '': 'index.html', admin: 'admin.html', flow: 'flow.html', system: 'system.html' };

// Resolves a request path to the template that answers it, or null when nothing does.
// { file, page, detailKey, slug } — page and below are set only for the view.html shell.
function resolveRoute(pathname) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '');
  const parts = trimmed === '' ? [''] : trimmed.split('/');
  if (parts.length === 1) {
    if (standalone[parts[0]]) return { file: standalone[parts[0]] };
    if (sections.includes(parts[0])) return { file: 'view.html', page: parts[0] };
    return null;
  }
  if (parts.length === 2 && detailOf[parts[0]] && parts[1]) {
    return { file: 'view.html', page: parts[0], detailKey: detailOf[parts[0]], slug: decodeURIComponent(parts[1]) };
  }
  return null;
}

// The readable path for an old query-string URL, so those redirect once instead of lingering as
// duplicates. /view.html?page=blog&post=x becomes /blog/x.
function legacyTarget(url) {
  // A query string that is not routing — ?type=apply on the flow, a campaign tag — is carried over.
  const carried = new URLSearchParams(url.search);
  for (const key of ['page', 'case', 'post', 'event']) carried.delete(key);
  const tail = carried.toString() ? `?${carried}` : '';

  if (url.pathname === '/index.html') return `/${tail}`;
  if (/^\/(admin|flow|system)\.html$/.test(url.pathname)) return url.pathname.replace('.html', '') + tail;
  if (url.pathname !== '/view.html') return null;
  const page = url.searchParams.get('page') || 'core';
  if (!sections.includes(page)) return `/${tail}`;
  const slug = detailOf[page] ? url.searchParams.get(detailOf[page]) : '';
  return (slug ? `/${page}/${encodeURIComponent(slug)}` : `/${page}`) + tail;
}

/* ---------- Share tags ---------- */

async function shareTags(request, url, route) {
  const base = origin(request);
  const site = 'Synthavia AI';
  let title = 'Synthavia AI — From Abia, for Africa';
  let description = "Building Africa's AI future from Abia. We train the talent, run the research, and ship AI that works for African realities.";
  let type = 'website';
  let schema = { '@context': 'https://schema.org', '@type': 'Organization', name: site, url: base, description, address: { '@type': 'PostalAddress', addressLocality: 'Aba', addressRegion: 'Abia State', addressCountry: 'NG' }, foundingDate: '2025' };

  if (route && route.page) {
    const published = await publicContent();
    const page = route.page;
    const slug = route.slug || '';
    const post = route.detailKey === 'post' ? published.posts.find((item) => item.slug === slug) : null;
    const project = route.detailKey === 'case' ? published.projects.find((item) => item.slug === slug) : null;
    const event = route.detailKey === 'event' ? published.events.find((item) => item.slug === slug) : null;
    if (post) {
      title = `${post.title} — ${site}`; description = post.dek; type = 'article';
      schema = { '@context': 'https://schema.org', '@type': 'Article', headline: post.title, description, author: { '@type': 'Organization', name: post.author }, publisher: { '@type': 'Organization', name: site } };
    } else if (project) {
      title = `${project.title} — ${site}`; description = project.lede; type = 'article';
      schema = { '@context': 'https://schema.org', '@type': 'ScholarlyArticle', headline: project.title, description, publisher: { '@type': 'Organization', name: site } };
    } else if (event) {
      title = `${event.title} — ${site}`; description = event.blurb; type = 'article';
      schema = event.startsAt ? { '@context': 'https://schema.org', '@type': 'Event', name: `${event.title} — ${event.subtitle}`, description, startDate: event.startsAt, location: { '@type': 'Place', name: event.venue }, organizer: { '@type': 'Organization', name: site }, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode' } : null;
    } else {
      const pages = {
        team: ['About & team', 'The people behind Synthavia AI. Every project on the site has a named owner.'],
        core: ['Synthavia Core', 'Workshops, cohorts, mentorship and open-source projects across Abia. Core is free and it stays free.'],
        lab: ['Synthavia Lab', 'Open datasets, small models and tools for agriculture, education, African-language NLP and enterprise.'],
        programs: ['Synthavia Programs', 'Fellowship, Internship and Accelerator tracks that turn intent into a shipped artefact.'],
        events: ['Synthavia Events', 'The flagship AI of Things summit, monthly Core meetups, study jams and demo days.'],
        blog: ['Blog & insights', 'Build notes, dataset releases, cohort write-ups and the occasional strong opinion.'],
        partners: ['Partner with Synthavia', 'Fund a cohort, host a lab, sponsor AI of Things, or open a hiring pipeline.'],
        contact: ['Contact Synthavia', 'Pick a topic and your message goes to the right person, not a shared inbox nobody reads.']
      }[page];
      if (pages) { title = `${pages[0]} — ${site}`; description = pages[1]; }
    }
  }

  const shareImage = ['share.png', 'share.jpg'].find((name) => fs.existsSync(path.join(publicDir, name))) || 'logo.png';
  // Readable paths carry all the routing, so query strings here are filters or campaign tags.
  // They must not fork the canonical URL into duplicates.
  const canonical = base + (url.pathname.replace(/\/+$/, '') || '/');
  const tags = `<meta property="og:site_name" content="${escapeXml(site)}" />
    <meta property="og:type" content="${type}" />
    <meta property="og:title" content="${escapeXml(title)}" />
    <meta property="og:description" content="${escapeXml(description)}" />
    <meta property="og:url" content="${escapeXml(canonical)}" />
    <meta property="og:image" content="${escapeXml(base)}/${shareImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeXml(title)}" />
    <meta name="twitter:description" content="${escapeXml(description)}" />
    <meta name="twitter:image" content="${escapeXml(base)}/${shareImage}" />
    <link rel="canonical" href="${escapeXml(canonical)}" />
    ${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}`;
  // The title and description go back too: view.js sets document.title, but a crawler that runs no
  // JavaScript needs both already in the markup.
  return { title, description, tags };
}

/* ---------- Static delivery ---------- */

// Assets only — css, js, images, fonts. On Vercel the CDN serves these and this never runs; it is
// what answers them when the app is hosted conventionally or run locally.
async function sendStatic(request, response, url) {
  const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(publicDir, requested);
  const extension = path.extname(file);
  if (!file.startsWith(publicDir + path.sep) || !types[extension] || extension === '.html') return sendNotFound(request, response, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendNotFound(request, response, url);
  return sendFile(request, response, url, fs.readFileSync(file), extension, fs.statSync(file).mtime);
}

// An HTML page. Every page is served from here, which is what keeps the share tags, the canonical
// URL and the view counter applying uniformly — precisely what breaks when a template sits in
// public/ and the CDN answers it directly.
async function sendPage(request, response, url, route, status = 200) {
  const file = path.join(viewsDir, route.file);
  if (!fs.existsSync(file)) return respond(response, 404, { error: 'Not found.' });
  let body = fs.readFileSync(file, 'utf8');
  // The admin is a private tool and the 404 is not content: neither gets share tags or a canonical.
  if (route.file !== 'admin.html' && route.file !== '404.html') {
    const share = await shareTags(request, url, route);
    body = body
      .replace('<title>Synthavia AI</title>', `<title>${escapeXml(share.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeXml(share.description)}" />`)
      .replace('</head>', `${share.tags}\n  </head>`);
  }
  return sendFile(request, response, url, body, '.html', fs.statSync(file).mtime, status);
}

// A path that is neither a route nor an asset gets the site's own 404 page, not raw JSON.
function sendNotFound(request, response, url) {
  if (url.pathname.startsWith('/api/')) return respond(response, 404, { error: 'Not found.' });
  return sendPage(request, response, url, { file: '404.html' }, 404);
}

function sendFile(request, response, url, body, extension, mtime, status = 200) {
  const isHtml = extension === '.html';

  // Uploaded media carries a content hash in its name, so it can be cached hard. Everything else
  // revalidates cheaply with an ETag.
  const immutable = url.pathname.startsWith('/media/');
  const etag = `"${crypto.createHash('sha1').update(typeof body === 'string' ? body : body).digest('hex').slice(0, 16)}"`;
  const headers = {
    'Content-Type': types[extension],
    'Cache-Control': isHtml ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600, must-revalidate',
    ETag: etag,
    'Last-Modified': mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff'
  };
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); return response.end(); }

  if (isHtml && status === 200) recordView(url, request).catch(() => {});

  const wantsGzip = /\bgzip\b/.test(request.headers['accept-encoding'] || '') && (isHtml || compressible.has(extension));
  if (wantsGzip) {
    const zipped = zlib.gzipSync(Buffer.from(body));
    response.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': zipped.length, Vary: 'Accept-Encoding' });
    return response.end(request.method === 'HEAD' ? undefined : zipped);
  }
  const buffer = Buffer.from(body);
  response.writeHead(status, { ...headers, 'Content-Length': buffer.length });
  response.end(request.method === 'HEAD' ? undefined : buffer);
}

// Counts only: a path, a day, and the referring host. No cookies, no IP, nothing per-visitor.
async function recordView(url, request) {
  try {
    const referrer = request.headers.referer ? new URL(request.headers.referer).host : '';
    const self = String(request.headers.host || '');
    const page = (url.pathname.replace(/\/+$/, '') || '/').slice(0, 120);
    await store.recordView(new Date().toISOString().slice(0, 10), page, referrer === self ? '' : referrer.slice(0, 80));
  } catch { /* analytics must never break a page */ }
}

/* ---------- Server ---------- */

async function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const ip = clientIp(request);
  try {
    if (url.pathname.startsWith('/api/')) {
      const limited = await rateLimited('api', ip);
      if (limited) return respond(response, 429, { error: limited });
    }

    if (url.pathname === '/api/health') return respond(response, 200, { ok: true, users: await store.userCount(), time: new Date().toISOString() });
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      return respond(response, 200, { metrics: (await store.stats()).map(({ key, label, value, source, signedOff }) => ({ key, label, source, signedOff, value: signedOff ? value : null })) });
    }
    if (url.pathname === '/api/content' && request.method === 'GET') return respond(response, 200, await publicContent());
    if (url.pathname === '/api/settings' && request.method === 'GET') return respond(response, 200, { settings: await settingsMap() });

    if (url.pathname === '/api/submissions' && request.method === 'POST') {
      const limited = await rateLimited('submit', ip);
      if (limited) return respond(response, 429, { error: limited });
      const entry = await buildEntry(await readBody(request));
      await store.addSubmission(entry);
      respond(response, 201, { id: entry.id });
      return notify.dispatch(notify.compose(entry, await settingsMap())).catch(() => {});
    }

    // First run: create the owner account. Only possible while no users exist.
    if (url.pathname === '/api/admin/setup') {
      if (request.method === 'GET') return respond(response, 200, { needed: (await store.userCount()) === 0 });
      if (request.method === 'POST') {
        if (await store.userCount() > 0) return respond(response, 403, { error: 'Setup has already been completed.' });
        const input = await readBody(request);
        const email = safeText(input.email, 160).toLowerCase();
        const password = String(input.password || '');
        if (!/^\S+@\S+\.\S+$/.test(email)) return respond(response, 400, { error: 'Enter a valid email address.' });
        if (password.length < 12) return respond(response, 400, { error: 'Use a password of at least 12 characters.' });
        const id = await store.addUser(email, safeText(input.name, 120) || 'Owner', 'owner', password);
        return respond(response, 201, { token: await store.createSession(id, sessionLife) });
      }
    }
    if (url.pathname === '/api/admin/login' && request.method === 'POST') {
      const limited = await rateLimited('login', ip);
      if (limited) return respond(response, 429, { error: limited });
      const input = await readBody(request);
      const account = await store.userByEmail(safeText(input.email, 160));
      if (!account || !store.verifyPassword(String(input.password || ''), account.password_hash)) {
        return respond(response, 401, { error: 'That email and password do not match.' });
      }
      await store.touchLogin(account.id);
      return respond(response, 200, { token: await store.createSession(account.id, sessionLife), user: { name: account.name, email: account.email, role: account.role } });
    }

    if (url.pathname.startsWith('/api/admin/')) {
      const user = await currentUser(request);
      if (!user) return respond(response, 401, { error: 'Admin sign-in is required.' });
      const ownerOnly = ['/api/admin/users', '/api/admin/backup'];
      if (ownerOnly.includes(url.pathname) && user.role !== 'owner') return respond(response, 403, { error: 'That action needs an owner account.' });

      if (url.pathname === '/api/admin/me') return respond(response, 200, { user });
      if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
        await store.dropSession(request.headers.authorization.replace(/^Bearer\s+/i, ''));
        return respond(response, 200, { ok: true });
      }
      if (url.pathname === '/api/admin/submissions') {
        if (request.method === 'GET') return respond(response, 200, { records: await store.submissions() });
        if (request.method === 'DELETE') { await store.clearSubmissions(); return respond(response, 200, { ok: true }); }
      }
      if (url.pathname === '/api/admin/stats') {
        if (request.method === 'GET') return respond(response, 200, { metrics: await store.stats() });
        if (request.method === 'POST') {
          const input = await readBody(request);
          const metric = (await store.stats()).find((entry) => entry.key === safeText(input.key, 40));
          if (!metric) return respond(response, 404, { error: 'No such metric.' });
          const signedOff = Boolean(input.signedOff) && Boolean(safeText(input.value, 40));
          if (signedOff && user.role !== 'owner') return respond(response, 403, { error: 'Only an owner can sign off a public figure.' });
          return respond(response, 200, {
            metric: await store.saveStat({
              key: metric.key, value: safeText(input.value, 40), source: safeText(input.source, 200) || metric.source,
              signedOff, updatedAt: new Date().toISOString(), signedOffBy: signedOff ? user.email : ''
            })
          });
        }
      }
      if (url.pathname === '/api/admin/content') {
        if (request.method === 'GET') return respond(response, 200, await content());
        if (request.method === 'POST' || request.method === 'DELETE') {
          const input = await readBody(request);
          const name = safeText(input.collection, 20);
          const config = collections[name];
          if (!config) return respond(response, 404, { error: 'No such collection.' });
          const list = await store.collection(name);
          const existing = list.find((item) => item.slug === safeText(input.slug, 80));
          if (request.method === 'DELETE') {
            if (!existing) return respond(response, 404, { error: 'No such item.' });
            await store.deleteItem(name, existing.slug);
            return respond(response, 200, { ok: true });
          }
          const stateKey = config.stateKey || 'status_publish';
          const state = safeText(input[stateKey], 30);
          if (state && !config.states.includes(state)) return respond(response, 400, { error: 'That status is not recognised.' });
          const item = existing ? { ...existing } : { slug: '', body: [], chips: [], tags: [] };
          for (const [field, limit] of Object.entries(config.fields)) {
            if (input[field] !== undefined) item[field] = safeText(input[field], limit);
          }
          if (state) item[stateKey] = state;
          if (!item.title && !item.name) return respond(response, 400, { error: 'A title is required.' });
          if (name === 'events' && item.startsAt && Number.isNaN(Date.parse(item.startsAt))) return respond(response, 400, { error: 'Use YYYY-MM-DD for the start date.' });
          if (!existing) {
            item.slug = slugify(input.slug || item.title || item.name);
            if (!item.slug || list.some((entry) => entry.slug === item.slug)) return respond(response, 400, { error: 'That slug is taken or invalid.' });
            if (name === 'posts') Object.assign(item, { initials: item.initials || 'SY', place: 'Aba, Nigeria', read: item.read || '—' });
          }
          item.updatedAt = new Date().toISOString();
          await store.saveItem(name, item, existing ? list.indexOf(existing) : list.length);
          return respond(response, 200, { item });
        }
      }
      if (url.pathname === '/api/admin/settings') {
        if (request.method === 'GET') return respond(response, 200, { settings: await settings() });
        if (request.method === 'POST') {
          const input = await readBody(request);
          const update = {};
          for (const entry of await settings()) {
            if (input[entry.key] === undefined) continue;
            const value = safeText(input[entry.key], 300);
            if (value && entry.url && !/^https:\/\/\S+$/.test(value)) return respond(response, 400, { error: `${entry.label} must be an https:// link.` });
            if (value && !entry.url && !/^\S+@\S+\.\S+$/.test(value)) return respond(response, 400, { error: `${entry.label} must be an email address.` });
            update[entry.key] = value;
          }
          await store.saveSettings(update);
          return respond(response, 200, { settings: await settings() });
        }
      }
      if (url.pathname === '/api/admin/media' && request.method === 'POST') {
        const limited = await rateLimited('media', ip);
        if (limited) return respond(response, 429, { error: limited });
        return respond(response, 201, await saveImage(await readBody(request, 6_000_000)));
      }
      if (url.pathname === '/api/admin/outbox') {
        if (request.method === 'GET') return respond(response, 200, { messages: await store.outbox(), configured: notify.configured });
        if (request.method === 'POST') return respond(response, 200, await notify.retry());
      }
      if (url.pathname === '/api/admin/analytics' && request.method === 'GET') {
        return respond(response, 200, await store.viewStats(Number(url.searchParams.get('days')) || 30));
      }
      if (url.pathname === '/api/admin/backup' && request.method === 'POST') return respond(response, 200, await store.backup());
      if (url.pathname === '/api/admin/users') {
        if (request.method === 'GET') return respond(response, 200, { users: await store.users(), me: user.id });
        if (request.method === 'POST') {
          const input = await readBody(request);
          const email = safeText(input.email, 160).toLowerCase();
          const password = String(input.password || '');
          const role = ['owner', 'editor'].includes(input.role) ? input.role : 'editor';
          if (input.id) {
            if (password && password.length < 12) return respond(response, 400, { error: 'Use a password of at least 12 characters.' });
            if (password) await store.setPassword(safeText(input.id, 60), password);
            if (input.role) await store.setUserRole(safeText(input.id, 60), role);
            return respond(response, 200, { users: await store.users() });
          }
          if (!/^\S+@\S+\.\S+$/.test(email)) return respond(response, 400, { error: 'Enter a valid email address.' });
          if (password.length < 12) return respond(response, 400, { error: 'Use a password of at least 12 characters.' });
          if (await store.userByEmail(email)) return respond(response, 400, { error: 'That email already has an account.' });
          await store.addUser(email, safeText(input.name, 120) || email, role, password);
          return respond(response, 201, { users: await store.users() });
        }
        if (request.method === 'DELETE') {
          const input = await readBody(request);
          const id = safeText(input.id, 60);
          if (id === user.id) return respond(response, 400, { error: 'You cannot delete the account you are signed in with.' });
          const owners = (await store.users()).filter((entry) => entry.role === 'owner');
          if (owners.length === 1 && owners[0].id === id) return respond(response, 400, { error: 'The last owner account cannot be deleted.' });
          await store.removeUser(id);
          return respond(response, 200, { users: await store.users() });
        }
      }
    }
    if (url.pathname.startsWith('/api/')) return respond(response, 404, { error: 'Not found.' });

    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${origin(request)}/sitemap.xml\n`);
    }
    if (url.pathname === '/sitemap.xml') {
      const base = origin(request);
      const published = await publicContent();
      const urls = ['/', ...sections.map((page) => `/${page}`),
        ...published.projects.map((item) => `/lab/${encodeURIComponent(item.slug)}`),
        ...published.posts.map((item) => `/blog/${encodeURIComponent(item.slug)}`),
        ...published.events.map((item) => `/events/${encodeURIComponent(item.slug)}`)];
      response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
      return response.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => `  <url><loc>${escapeXml(base + entry)}</loc></url>`).join('\n')}\n</urlset>\n`);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond(response, 405, { error: 'Method not allowed.' });

    // One canonical URL per page. The old query-string and .html URLs still work, but they answer
    // with a permanent redirect so links already in the wild consolidate rather than duplicate.
    const legacy = legacyTarget(url);
    if (legacy) {
      response.writeHead(301, { Location: legacy, 'Cache-Control': 'public, max-age=3600' });
      return response.end();
    }
    // A trailing slash is the same page, not a second one.
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      response.writeHead(301, { Location: url.pathname.replace(/\/+$/, '') + (url.search || ''), 'Cache-Control': 'public, max-age=3600' });
      return response.end();
    }

    const route = resolveRoute(url.pathname);
    if (route) return sendPage(request, response, url, route);
    return sendStatic(request, response, url);
  } catch (error) {
    respond(response, 400, { error: error.message || 'Request failed.' });
  }
}

const server = http.createServer(handler);

/* ---------- Start ---------- */

async function start() {
  try {
    await store.userCount();
  } catch (error) {
    console.error('Cannot read the database. Has the schema been created?');
    console.error('Run:  npm run migrate');
    throw error;
  }

  if ((await store.userCount()) === 0 && process.env.SYNTHAVIA_ADMIN_EMAIL && process.env.SYNTHAVIA_ADMIN_PASSWORD) {
    await store.addUser(process.env.SYNTHAVIA_ADMIN_EMAIL, process.env.SYNTHAVIA_ADMIN_NAME || 'Owner', 'owner', process.env.SYNTHAVIA_ADMIN_PASSWORD);
    console.log('Created owner account from environment:', process.env.SYNTHAVIA_ADMIN_EMAIL);
  }

  await store.dropExpiredSessions();
  // Serverless has no long-lived process, so these run only when the app is hosted conventionally.
  if (!process.env.VERCEL) {
    setInterval(() => store.dropExpiredSessions().catch(() => {}), 60 * 60_000).unref();
    setInterval(() => store.pruneRateHits().catch(() => {}), 30 * 60_000).unref();
    if (backupHours > 0) {
      store.backup().catch((error) => console.error('Backup failed:', error.message));
      setInterval(() => store.backup().catch((error) => console.error('Backup failed:', error.message)), backupHours * 3_600_000).unref();
    }
  }

  server.listen(port, host, async () => {
    console.log(`Synthavia app: http://${host}:${port}`);
    console.log(`Storage: ${remoteStorage ? 'Supabase (' + storageBucket + ')' : 'local disk (public/media)'}`);
    if ((await store.userCount()) === 0) console.log('No admin account yet — open /admin.html to create the first owner.');
  });
}

if (require.main === module) {
  start().catch((error) => { console.error('Startup failed:', error.message); process.exit(1); });
}
module.exports = { handler, server, start, publicContent, buildEntry, rateLimited, saveImage };
