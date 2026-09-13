// Run with: npm test
// Boots the real server against the real Postgres, but inside a throwaway schema that is created
// at the start and dropped at the end — so the tests exercise production code paths without ever
// touching production rows. Requires POSTGRES_URL in .env.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'synthavia-test-'));
const port = 4200 + (process.pid % 400);
const testSchema = `synthavia_test_${process.pid}`;
const base = `http://127.0.0.1:${port}`;
const owner = { email: 'owner@test.local', password: 'test-password-12345', name: 'Test Owner' };
let child;

// A copy of the project with its own empty data directory: the real one is never touched.
function prepareSandbox() {
  for (const entry of ['server.js', 'db.js', 'notify.js', 'migrate.js', 'content.json', 'public', 'views', 'node_modules']) {
    fs.cpSync(path.join(projectRoot, entry), path.join(sandbox, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
}

async function boot() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: sandbox,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PGSCHEMA: testSchema, SYNTHAVIA_BACKUP_HOURS: '0',
           SYNTHAVIA_ADMIN_EMAIL: owner.email, SYNTHAVIA_ADMIN_PASSWORD: owner.password, SYNTHAVIA_ADMIN_NAME: owner.name,
           SYNTHAVIA_RATE_SUBMIT: '40', SYNTHAVIA_RATE_LOGIN: '60', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childLog = '';
  child.stdout.on('data', (d) => { childLog += d; });
  child.stderr.on('data', (d) => { childLog += d; });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start. Child output:\n${childLog.trim() || '(silent)'}`);
}

const call = async (route, options = {}) => {
  const response = await fetch(base + route, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
};
const auth = (token) => ({ Authorization: `Bearer ${token}` });
const post = (route, payload, token) => call(route, { method: 'POST', body: JSON.stringify(payload), headers: token ? auth(token) : {} });

let token;

test.before(async () => {
  prepareSandbox();
  // Schema first, exactly as production does it (npm run migrate, then start).
  execFileSync(process.execPath, ['migrate.js'], { cwd: sandbox, env: { ...process.env, PGSCHEMA: testSchema }, stdio: 'ignore' });
  await boot();
  token = (await post('/api/admin/login', { email: owner.email, password: owner.password })).body.token;
  assert.ok(token, 'owner login should return a token');
});
test.after(async () => {
  child?.kill();
  // Drop the throwaway schema so repeated runs do not accumulate tables in the project.
  const { Pool } = require(path.join(projectRoot, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL_DIRECT || process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false }, max: 1 });
  try { await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`); } finally { await pool.end(); }
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
});

/* ---------- Publish state ---------- */

test('drafts never reach the public API', async () => {
  const publicView = (await call('/api/content')).body;
  const adminView = (await call('/api/admin/content', { headers: auth(token) })).body;
  assert.ok(adminView.posts.length > publicView.posts.length, 'admin should see more posts than the public');
  assert.equal(publicView.posts.filter((p) => p.status_publish !== 'Published').length, 0);
  assert.equal(publicView.events.filter((e) => e.status_publish !== 'Published').length, 0);
  assert.equal(publicView.partners.length, 0, 'no partner is countersigned in the seed');
});

test('publishing an item makes it public, unpublishing hides it again', async () => {
  const draft = (await call('/api/admin/content', { headers: auth(token) })).body.events.find((e) => e.status_publish === 'Draft');
  await post('/api/admin/content', { collection: 'events', slug: draft.slug, status_publish: 'Published' }, token);
  assert.ok((await call('/api/content')).body.events.some((e) => e.slug === draft.slug));
  await post('/api/admin/content', { collection: 'events', slug: draft.slug, status_publish: 'Draft' }, token);
  assert.ok(!(await call('/api/content')).body.events.some((e) => e.slug === draft.slug));
});

/* ---------- Stat sign-off ---------- */

test('an unsigned figure never leaves the server as a number', async () => {
  const pending = (await call('/api/stats')).body.metrics.find((m) => !m.signedOff);
  assert.equal(pending.value, null, 'pending metrics must be null, not a hidden value');
});

test('sign-off requires a value and records who did it', async () => {
  const refused = await post('/api/admin/stats', { key: 'trained', value: '', signedOff: true }, token);
  assert.equal(refused.body.metric.signedOff, false, 'cannot sign off an empty figure');
  const signed = await post('/api/admin/stats', { key: 'trained', value: '312', source: 'Audit', signedOff: true }, token);
  assert.equal(signed.body.metric.signedOff, true);
  assert.equal(signed.body.metric.signedOffBy, owner.email);
  assert.equal((await call('/api/stats')).body.metrics.find((m) => m.key === 'trained').value, '312');
  await post('/api/admin/stats', { key: 'trained', value: '', source: 'Attendance audit incomplete', signedOff: false }, token);
});

/* ---------- Auth and roles ---------- */

test('admin routes reject anonymous callers', async () => {
  for (const route of ['/api/admin/content', '/api/admin/submissions', '/api/admin/users', '/api/admin/analytics']) {
    assert.equal((await call(route)).status, 401, `${route} should require a session`);
  }
});

test('an editor cannot sign off figures or manage accounts', async () => {
  await post('/api/admin/users', { email: 'editor@test.local', password: 'editor-password-123', name: 'Ed', role: 'editor' }, token);
  const editorToken = (await post('/api/admin/login', { email: 'editor@test.local', password: 'editor-password-123' })).body.token;
  assert.equal((await post('/api/admin/stats', { key: 'members', value: '9', signedOff: true }, editorToken)).status, 403);
  assert.equal((await call('/api/admin/users', { headers: auth(editorToken) })).status, 403);
  // but may still edit content
  assert.equal((await call('/api/admin/content', { headers: auth(editorToken) })).status, 200);
});

test('the last owner cannot be deleted and sessions end on sign-out', async () => {
  const me = (await call('/api/admin/me', { headers: auth(token) })).body.user;
  const removal = await call('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ id: me.id }), headers: auth(token) });
  assert.equal(removal.status, 400);

  const temporary = (await post('/api/admin/login', { email: owner.email, password: owner.password })).body.token;
  await post('/api/admin/logout', {}, temporary);
  assert.equal((await call('/api/admin/me', { headers: auth(temporary) })).status, 401);
});

test('wrong passwords are rejected', async () => {
  assert.equal((await post('/api/admin/login', { email: owner.email, password: 'not-the-password' })).status, 401);
});

/* ---------- Submissions, spam and validation ---------- */

test('a valid submission is stored and acknowledged', async () => {
  const result = await post('/api/submissions', { type: 'Core signup', name: 'Ada', email: `ada-${Date.now()}@test.local`, interest: 'Join a project' });
  assert.equal(result.status, 201);
  assert.match(result.body.id, /^SY-[0-9A-F]{6}$/);
});

test('the honeypot field blocks automated submissions', async () => {
  const result = await post('/api/submissions', { type: 'Core signup', name: 'Bot', email: 'bot@test.local', company: 'Acme Spam Co' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /automated/i);
});

test('bad input is refused', async () => {
  assert.match((await post('/api/submissions', { type: 'Nope', email: 'a@b.co', name: 'x' })).body.error, /not recognised/);
  assert.match((await post('/api/submissions', { type: 'Core signup', email: 'not-an-email', name: 'x' })).body.error, /email/i);
  assert.match((await post('/api/submissions', { type: 'Core signup', email: 'a@b.co' })).body.error, /name/i);
  assert.match((await post('/api/submissions', { type: 'Partner enquiry', name: 'x', email: 'p@b.co', organisation: 'Org' })).body.error, /required/i);
});

test('the same person cannot submit the same form twice in a minute', async () => {
  const email = `dupe-${Date.now()}@test.local`;
  assert.equal((await post('/api/submissions', { type: 'Contact message', name: 'Ada', email })).status, 201);
  const second = await post('/api/submissions', { type: 'Contact message', name: 'Ada', email });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /already have that one/i);
});

/* ---------- Uploads ---------- */

test('uploads accept real images and reject disguised files', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const good = await post('/api/admin/media', { name: 'portrait', data: `data:image/png;base64,${png.toString('base64')}` }, token);
  assert.equal(good.status, 201);
  assert.match(good.body.url, /^\/media\/portrait-[0-9a-f]{8}\.png$/);

  const disguised = Buffer.from('<script>alert(1)</script>');
  const bad = await post('/api/admin/media', { name: 'evil', data: `data:image/png;base64,${disguised.toString('base64')}` }, token);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /PNG, JPEG and WebP/);
});

/* ---------- Durability ---------- */

test('concurrent submissions all survive', async () => {
  const before = (await call('/api/admin/submissions', { headers: auth(token) })).body.records.length;
  // Rate limiting is per IP, so write straight through the store the way the handler does.
  const script = `
    process.env.PGSCHEMA = ${JSON.stringify(testSchema)};
    const store = require('./db.js');
    const writes = Array.from({ length: 40 }, (_, i) => ({
      id: 'CT-' + String(i).padStart(4, '0'), createdAt: new Date().toISOString(),
      type: 'Contact message', name: 'Race ' + i, email: 'race' + i + '@test.local'
    }));
    (async () => {
      await Promise.all(writes.map((entry) => store.addSubmission(entry)));
      const all = await store.submissions();
      console.log(all.filter((r) => r.id.startsWith('CT-')).length);
      await store.close();
    })();
  `;
  const written = Number(execFileSync(process.execPath, ['-e', script], { cwd: sandbox, encoding: 'utf8', env: { ...process.env, PGSCHEMA: testSchema, PGPOOL_MAX: '12' } }).trim());
  assert.equal(written, 40, 'every concurrent write should be present');
  const after = (await call('/api/admin/submissions', { headers: auth(token) })).body.records.length;
  assert.equal(after, before + 40);
});

test('a backup exports every table', async () => {
  const result = await post('/api/admin/backup', {}, token);
  assert.ok(result.body.bytes > 0);
  const file = path.join(sandbox, 'data', 'backups', result.body.file);
  assert.ok(fs.existsSync(file));
  const dump = JSON.parse(fs.readFileSync(file, 'utf8')).dump;
  assert.ok(dump.content.length > 0, 'content must be in the export');
  assert.ok(dump.users.length > 0, 'accounts must be in the export');
  assert.ok(dump.submissions.length > 0, 'submissions must be in the export');
});

/* ---------- Delivery and SEO ---------- */

test('every submission queues an acknowledgement and a team notification', async () => {
  const before = (await call('/api/admin/outbox', { headers: auth(token) })).body.messages.length;
  await post('/api/submissions', { type: 'Contact message', name: 'Mail', email: `mail-${Date.now()}@test.local`, idea: 'Hello' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const after = (await call('/api/admin/outbox', { headers: auth(token) })).body.messages;
  assert.equal(after.length, before + 2, 'one to the sender, one to the owning inbox');
});

test('share tags and sitemap describe only published content', async () => {
  const page = (await call('/blog/no-wrapper')).body;
  assert.match(page, /og:title" content="African AI does not need another wrapper/);
  assert.match(page, /application\/ld\+json/);
  assert.match(page, /<title>African AI does not need another wrapper/, 'the title must be in the markup, not only set by JS');
  assert.match(page, /rel="canonical" href="[^"]*\/blog\/no-wrapper"/);
  const sitemap = (await call('/sitemap.xml')).body;
  assert.ok(!sitemap.includes('cohort-03-retro'), 'a draft post must not be listed in the sitemap');
  assert.ok(sitemap.includes('<loc>' + base + '/programs</loc>'), 'the sitemap must list readable paths');
  assert.ok(!sitemap.includes('view.html'), 'no query-string URLs in the sitemap');
  assert.match((await call('/robots.txt')).body, /Disallow: \/admin/);
});

/* ---------- Readable URLs ---------- */

test('every section and detail page answers on its own path', async () => {
  for (const route of ['/', '/team', '/core', '/lab', '/programs', '/events', '/blog', '/partners', '/contact',
                       '/admin', '/flow', '/system', '/blog/no-wrapper', '/lab/cassava-disease-vision']) {
    const response = await call(route);
    assert.equal(response.status, 200, `${route} should be a page`);
    assert.match(response.body, /<!doctype html>/i, `${route} should return HTML`);
  }
});

test('the old query-string URLs redirect once to the readable path', async () => {
  const cases = [
    ['/view.html?page=programs', '/programs'],
    ['/view.html?page=blog&post=no-wrapper', '/blog/no-wrapper'],
    ['/view.html?page=lab&case=cassava-disease-vision', '/lab/cassava-disease-vision'],
    ['/index.html', '/'],
    ['/admin.html', '/admin'],
    ['/programs/', '/programs'],
    // A query string that is not routing has to survive the redirect.
    ['/flow.html?type=apply', '/flow?type=apply'],
    ['/view.html?page=blog&post=no-wrapper&utm_source=x', '/blog/no-wrapper?utm_source=x']
  ];
  for (const [from, to] of cases) {
    const response = await fetch(base + from, { redirect: 'manual' });
    assert.equal(response.status, 301, `${from} should redirect permanently`);
    assert.equal(response.headers.get('location'), to, `${from} should land on ${to}`);
  }
});

test('an unknown path gets the site 404 page, not raw JSON', async () => {
  const response = await call('/no-such-page');
  assert.equal(response.status, 404);
  assert.match(response.body, /This page does not exist/);
  assert.match(response.body, /name="robots" content="noindex"/);
  // The API keeps answering in JSON — only pages get the HTML treatment.
  const api = await call('/api/no-such-endpoint');
  assert.equal(api.status, 404);
  assert.equal(typeof api.body, 'object');
});

test('the private pages are not indexable', async () => {
  for (const route of ['/admin', '/system', '/flow']) {
    assert.match((await call(route)).body, /name="robots" content="noindex/, route + ' must be noindex');
  }
  // The admin never leaks share tags either — it is a private tool, not content.
  assert.ok(!(await call('/admin')).body.includes('og:title'));
});

test('no HTML template sits in public/', () => {
  // This is the trap that silently broke production: public/ is Vercel's static output directory,
  // and its CDN answers any file there before a rewrite is consulted. An .html file in public/ is
  // therefore served raw — skipping the share tags, the canonical URL and the view counter, with
  // no error anywhere. Templates belong in views/.
  const stray = fs.readdirSync(path.join(projectRoot, 'public')).filter((name) => name.endsWith('.html'));
  assert.deepEqual(stray, [], 'move these into views/');
});

/* ---------- Static serving ---------- */

test('server source and the data store are unreachable over HTTP', async () => {
  for (const route of ['/server.js', '/db.js', '/notify.js', '/content.json', '/.env', '/../server.js', '/views/view.html', '/../views/view.html']) {
    assert.equal((await call(route)).status, 404, `${route} must not be served`);
  }
});

test('assets are compressed and cacheable', async () => {
  const response = await fetch(`${base}/pages.css`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.match(response.headers.get('cache-control'), /max-age/);
  const etag = response.headers.get('etag');
  const repeat = await fetch(`${base}/pages.css`, { headers: { 'If-None-Match': etag } });
  assert.equal(repeat.status, 304, 'a matching ETag should return 304');
});

/* ---------- Rate limiting (last: it exhausts the per-IP budget) ---------- */

test('submissions are rate limited per connection', async () => {
  let limited = false;
  for (let i = 0; i < 60; i += 1) {
    const result = await post('/api/submissions', { type: 'Newsletter signup', email: `flood-${i}-${Date.now()}@test.local` });
    if (result.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'a flood of submissions should hit the rate limit');
});
