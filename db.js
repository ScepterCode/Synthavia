// Durable storage on Postgres (Supabase). Every write runs in a transaction, so concurrent
// requests cannot overwrite each other.
//
// Two connections, deliberately:
//   • POSTGRES_URL        — transaction pooler (6543). Runtime queries. Survives serverless cold
//                           starts. node-postgres avoids named prepared statements, which is what
//                           makes it compatible with Supavisor's transaction mode.
//   • POSTGRES_URL_DIRECT — session pooler (5432). Schema creation only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const dataDir = path.join(__dirname, 'data');
const backupDir = path.join(dataDir, 'backups');
const schema = process.env.PGSCHEMA || 'public';
const runtimeUrl = process.env.POSTGRES_URL;
const migrateUrl = process.env.POSTGRES_URL_DIRECT || runtimeUrl;

if (!runtimeUrl) throw new Error('POSTGRES_URL is not set. Copy .env.example to .env and fill in the Supabase connection strings.');

const ssl = { rejectUnauthorized: false };
const pool = new Pool({
  connectionString: runtimeUrl, ssl, options: `-c search_path=${schema}`,
  max: Number(process.env.PGPOOL_MAX || 4), idleTimeoutMillis: 20_000, connectionTimeoutMillis: 15_000
});
pool.on('error', (error) => console.error('Postgres pool error:', error.message));

const query = (text, params) => pool.query(text, params);
const rows = async (text, params) => (await pool.query(text, params)).rows;
const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;

// A transaction needs a single client for its whole life, so it is checked out of the pool.
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

/* ---------- Schema ---------- */

async function migrate() {
  const admin = new Pool({ connectionString: migrateUrl, ssl, max: 1, connectionTimeoutMillis: 20_000 });
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.submissions (
        id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), type text NOT NULL,
        name text, email text, payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS submissions_created ON ${schema}.submissions (created_at DESC);
      CREATE INDEX IF NOT EXISTS submissions_dupe ON ${schema}.submissions (type, email, created_at DESC);

      CREATE TABLE IF NOT EXISTS ${schema}.stats (
        key text PRIMARY KEY, label text, used_on text, value text, source text,
        signed_off boolean NOT NULL DEFAULT false, updated_at timestamptz, signed_off_by text, ordinal serial
      );
      CREATE TABLE IF NOT EXISTS ${schema}.content (
        collection text NOT NULL, slug text NOT NULL, position integer NOT NULL DEFAULT 0,
        doc jsonb NOT NULL, PRIMARY KEY (collection, slug)
      );
      CREATE TABLE IF NOT EXISTS ${schema}.statics (key text PRIMARY KEY, doc jsonb NOT NULL);
      CREATE TABLE IF NOT EXISTS ${schema}.settings (key text PRIMARY KEY, value text);

      CREATE TABLE IF NOT EXISTS ${schema}.outbox (
        id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), recipient text,
        subject text, body text, status text, attempts integer DEFAULT 0, error text, sent_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS ${schema}.users (
        id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text, role text NOT NULL,
        password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_login timestamptz
      );
      CREATE TABLE IF NOT EXISTS ${schema}.sessions (
        token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES ${schema}.users (id) ON DELETE CASCADE,
        expires_at bigint NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${schema}.pageviews (
        day date NOT NULL, path text NOT NULL, referrer text NOT NULL DEFAULT '',
        count integer NOT NULL DEFAULT 0, PRIMARY KEY (day, path, referrer)
      );
      -- Rate limiting lives in the database because serverless instances do not share memory.
      CREATE TABLE IF NOT EXISTS ${schema}.rate_hits (
        bucket text NOT NULL, client text NOT NULL, at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS rate_hits_lookup ON ${schema}.rate_hits (bucket, client, at DESC);
    `);
    // Added after the first release: who sent a hand-written email. Blank for automatic mail.
    await admin.query(`ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS sent_by text`);
    await admin.query(`ALTER TABLE ${schema}.outbox ADD COLUMN IF NOT EXISTS reply_to text`);
  } finally {
    await admin.end();
  }
}

/* ---------- Submissions ---------- */

const addSubmission = (entry) => transaction(async (client) => {
  await client.query(
    'INSERT INTO submissions (id, created_at, type, name, email, payload) VALUES ($1, $2, $3, $4, $5, $6)',
    [entry.id, entry.createdAt, entry.type, entry.name || '', entry.email || '', JSON.stringify(entry)]
  );
  return entry;
});
const submissions = async () => (await rows('SELECT payload FROM submissions ORDER BY created_at DESC')).map((row) => row.payload);
const clearSubmissions = () => query('DELETE FROM submissions');
async function recentDuplicate(type, email, seconds = 60) {
  if (!email) return false;
  const row = await one(
    `SELECT 1 FROM submissions WHERE type = $1 AND email = $2 AND created_at > now() - ($3 || ' seconds')::interval LIMIT 1`,
    [type, email, String(seconds)]
  );
  return Boolean(row);
}

/* ---------- Stats ---------- */

const statColumns = 'key, label, used_on AS "usedOn", value, source, signed_off AS "signedOff", updated_at AS "updatedAt", signed_off_by AS "signedOffBy"';
const stats = () => rows(`SELECT ${statColumns} FROM stats ORDER BY ordinal`);
const saveStat = (metric) => transaction(async (client) => {
  await client.query(
    'UPDATE stats SET value = $1, source = $2, signed_off = $3, updated_at = $4, signed_off_by = $5 WHERE key = $6',
    [metric.value, metric.source, Boolean(metric.signedOff), metric.updatedAt, metric.signedOffBy || '', metric.key]
  );
  const { rows: found } = await client.query(`SELECT ${statColumns} FROM stats WHERE key = $1`, [metric.key]);
  return found[0];
});

/* ---------- Content ---------- */

const collection = async (name) => (await rows('SELECT doc FROM content WHERE collection = $1 ORDER BY position, slug', [name])).map((row) => row.doc);
const contentStatic = async (key) => (await one('SELECT doc FROM statics WHERE key = $1', [key]))?.doc || [];
const saveItem = (name, item, position = 0) => transaction(async (client) => {
  await client.query(
    `INSERT INTO content (collection, slug, position, doc) VALUES ($1, $2, $3, $4)
     ON CONFLICT (collection, slug) DO UPDATE SET doc = EXCLUDED.doc, position = EXCLUDED.position`,
    [name, item.slug, position, JSON.stringify(item)]
  );
  return item;
});
const deleteItem = (name, slug) => query('DELETE FROM content WHERE collection = $1 AND slug = $2', [name, slug]);

/* ---------- Settings ---------- */

const settingsRaw = async () => Object.fromEntries((await rows('SELECT key, value FROM settings')).map((row) => [row.key, row.value]));
const saveSettings = (values) => transaction(async (client) => {
  for (const [key, value] of Object.entries(values)) {
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
  }
});

/* ---------- Outbox ---------- */

const addMessage = (message) => query(
  'INSERT INTO outbox (id, created_at, recipient, subject, body, status, attempts, error, sent_at, sent_by, reply_to) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
  [message.id, message.createdAt, message.to, message.subject, message.body, message.status, message.attempts, message.error || '', message.sentAt || null, message.sentBy || '', message.replyTo || '']
);
const outbox = (limit = 200) => rows(
  'SELECT id, created_at AS "createdAt", recipient AS "to", subject, body, status, attempts, error, sent_at AS "sentAt", sent_by AS "sentBy", reply_to AS "replyTo" FROM outbox ORDER BY created_at DESC LIMIT $1',
  [limit]
);
const updateMessage = (message) => query(
  'UPDATE outbox SET status = $1, attempts = $2, error = $3, sent_at = $4 WHERE id = $5',
  [message.status, message.attempts, message.error || '', message.sentAt || null, message.id]
);

/* ---------- Users and sessions ---------- */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const users = () => rows('SELECT id, email, name, role, created_at AS "createdAt", last_login AS "lastLogin" FROM users ORDER BY created_at');
const userCount = async () => Number((await one('SELECT COUNT(*)::int AS n FROM users')).n);
const userByEmail = (email) => one('SELECT * FROM users WHERE email = $1', [String(email).toLowerCase()]);
const addUser = (email, name, role, password) => transaction(async (client) => {
  const id = crypto.randomUUID();
  await client.query('INSERT INTO users (id, email, name, role, password_hash) VALUES ($1, $2, $3, $4, $5)',
    [id, String(email).toLowerCase(), name, role, hashPassword(password)]);
  return id;
});
const setPassword = (id, password) => query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), id]);
const setUserRole = (id, role) => query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
const removeUser = (id) => query('DELETE FROM users WHERE id = $1', [id]);
const touchLogin = (id) => query('UPDATE users SET last_login = now() WHERE id = $1', [id]);

const createSession = async (userId, life) => {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, userId, Date.now() + life]);
  return token;
};
async function sessionUser(token) {
  const row = await one(
    `SELECT u.id, u.email, u.name, u.role, s.expires_at AS "expiresAt"
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`, [token]
  );
  if (!row) return null;
  if (Number(row.expiresAt) < Date.now()) { await dropSession(token); return null; }
  return row;
}
const dropSession = (token) => query('DELETE FROM sessions WHERE token = $1', [token]);
const dropExpiredSessions = () => query('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);

/* ---------- Rate limiting ---------- */
// Counted in the database: serverless instances do not share memory, so an in-process
// counter would reset on every cold start and let a flood through.

// Returns how many hits were already recorded in the window, not counting this one — the
// counting branch of the CTE cannot see the row the inserting branch just wrote.
async function rateCount(bucket, client, windowMs) {
  const { rows: counted } = await query(
    `WITH fresh AS (
       INSERT INTO rate_hits (bucket, client) VALUES ($1, $2) RETURNING 1
     )
     SELECT COUNT(*)::int AS n FROM rate_hits
     WHERE bucket = $1 AND client = $2 AND at > now() - ($3 || ' milliseconds')::interval`,
    [bucket, client, String(windowMs)]
  );
  return counted[0].n;
}
const pruneRateHits = () => query("DELETE FROM rate_hits WHERE at < now() - interval '1 hour'");

/* ---------- Analytics ---------- */

const recordView = (day, pagePath, referrer) => query(
  `INSERT INTO pageviews (day, path, referrer, count) VALUES ($1, $2, $3, 1)
   ON CONFLICT (day, path, referrer) DO UPDATE SET count = pageviews.count + 1`,
  [day, pagePath, referrer]
);
async function viewStats(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const [total, pages, referrers, daily] = await Promise.all([
    one('SELECT COALESCE(SUM(count), 0)::int AS n FROM pageviews WHERE day >= $1', [since]),
    rows('SELECT path, SUM(count)::int AS views FROM pageviews WHERE day >= $1 GROUP BY path ORDER BY views DESC LIMIT 15', [since]),
    rows("SELECT referrer, SUM(count)::int AS views FROM pageviews WHERE day >= $1 AND referrer <> '' GROUP BY referrer ORDER BY views DESC LIMIT 10", [since]),
    rows('SELECT to_char(day, \'YYYY-MM-DD\') AS day, SUM(count)::int AS views FROM pageviews WHERE day >= $1 GROUP BY day ORDER BY day', [since])
  ]);
  return { total: total.n, pages, referrers, daily };
}

/* ---------- Seeding ---------- */

async function seed(seedStats, seedSettings, seedContent) {
  // Batched into one statement per table: seeding ran 30+ sequential round trips, which is slow
  // enough over a remote database to delay startup by seconds.
  const values = (count, columns, offset = 0) =>
    Array.from({ length: count }, (_, row) =>
      `(${Array.from({ length: columns }, (_, col) => `$${offset + row * columns + col + 1}`).join(', ')})`).join(', ');

  await transaction(async (client) => {
    if (seedStats.length) {
      await client.query(
        `INSERT INTO stats (key, label, used_on, value, source, signed_off) VALUES ${values(seedStats.length, 6)} ON CONFLICT (key) DO NOTHING`,
        seedStats.flatMap((m) => [m.key, m.label, m.usedOn, m.value, m.source, Boolean(m.signedOff)])
      );
    }
    if (seedSettings.length) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ${values(seedSettings.length, 2)} ON CONFLICT (key) DO NOTHING`,
        seedSettings.flatMap((s) => [s.key, s.value])
      );
    }
    const records = [];
    const statics = [];
    for (const [name, items] of Object.entries(seedContent)) {
      if (!Array.isArray(items) || !items.length) continue;
      // Editorial lists with no slug (tiers, spend, topics, faqs) are reference data, not records.
      if (!items[0].slug) statics.push([name, JSON.stringify(items)]);
      else items.forEach((item, index) => records.push([name, item.slug, index, JSON.stringify(item)]));
    }
    if (statics.length) {
      await client.query(
        `INSERT INTO statics (key, doc) VALUES ${values(statics.length, 2)} ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc`,
        statics.flat()
      );
    }
    if (records.length) {
      await client.query(
        `INSERT INTO content (collection, slug, position, doc) VALUES ${values(records.length, 4)} ON CONFLICT (collection, slug) DO NOTHING`,
        records.flat()
      );
    }
  });
}

/* ---------- Backups ---------- */
// Supabase's free tier has no automated backups, so the application keeps its own: a JSON export
// of every table, which restore() can read back into an empty database.

async function backup(keep = 14) {
  fs.mkdirSync(backupDir, { recursive: true });
  const dump = {};
  for (const table of ['submissions', 'stats', 'content', 'statics', 'settings', 'outbox', 'users', 'pageviews']) {
    dump[table] = await rows(`SELECT * FROM ${table}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(backupDir, `synthavia-${stamp}.json`);
  fs.writeFileSync(target, JSON.stringify({ takenAt: new Date().toISOString(), schema, dump }, null, 2));
  const old = fs.readdirSync(backupDir).filter((name) => name.endsWith('.json')).sort().slice(0, -keep);
  for (const name of old) fs.unlinkSync(path.join(backupDir, name));
  return { file: path.basename(target), bytes: fs.statSync(target).size, rows: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])) };
}

async function restore(file) {
  const { dump } = JSON.parse(fs.readFileSync(file, 'utf8'));
  await transaction(async (client) => {
    for (const [table, records] of Object.entries(dump)) {
      for (const record of records) {
        const columns = Object.keys(record);
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
        const values = columns.map((column) => (record[column] !== null && typeof record[column] === 'object' ? JSON.stringify(record[column]) : record[column]));
        await client.query(`INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
      }
    }
  });
  return Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
}

const close = () => pool.end();

module.exports = {
  pool, query, transaction, migrate, dataDir, backupDir, schema,
  addSubmission, submissions, clearSubmissions, recentDuplicate,
  stats, saveStat,
  collection, contentStatic, saveItem, deleteItem,
  settingsRaw, saveSettings,
  addMessage, outbox, updateMessage,
  users, userCount, userByEmail, addUser, setPassword, setUserRole, removeUser, touchLogin,
  createSession, sessionUser, dropSession, dropExpiredSessions,
  rateCount, pruneRateHits,
  recordView, viewStats,
  hashPassword, verifyPassword,
  seed, backup, restore, close
};
