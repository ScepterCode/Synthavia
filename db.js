// Durable storage. Replaces the JSON files: every write is a transaction, so two requests landing
// at the same instant can no longer lose each other's data. Uses Node's built-in SQLite, so the
// project still has no third-party dependencies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const root = __dirname;
const dataDir = path.join(root, 'data');
const dbFile = path.join(dataDir, 'synthavia.db');
const backupDir = path.join(dataDir, 'backups');

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, type TEXT NOT NULL,
    name TEXT, email TEXT, payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS submissions_created ON submissions (created_at DESC);
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY, label TEXT, used_on TEXT, value TEXT,
    source TEXT, signed_off INTEGER DEFAULT 0, updated_at TEXT, signed_off_by TEXT
  );
  CREATE TABLE IF NOT EXISTS content (
    collection TEXT NOT NULL, slug TEXT NOT NULL, position INTEGER DEFAULT 0,
    doc TEXT NOT NULL, PRIMARY KEY (collection, slug)
  );
  CREATE TABLE IF NOT EXISTS statics (key TEXT PRIMARY KEY, doc TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY, created_at TEXT, recipient TEXT, subject TEXT, body TEXT,
    status TEXT, attempts INTEGER DEFAULT 0, error TEXT, sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, role TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT, last_login TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS pageviews (
    day TEXT NOT NULL, path TEXT NOT NULL, referrer TEXT NOT NULL DEFAULT '',
    count INTEGER DEFAULT 0, PRIMARY KEY (day, path, referrer)
  );
`);

const tx = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(...args); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
};

/* ---------- Submissions ---------- */

const addSubmission = tx((entry) => {
  db.prepare('INSERT INTO submissions (id, created_at, type, name, email, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.id, entry.createdAt, entry.type, entry.name || '', entry.email || '', JSON.stringify(entry));
  return entry;
});
const submissions = () => db.prepare('SELECT payload FROM submissions ORDER BY created_at DESC').all().map((row) => JSON.parse(row.payload));
const clearSubmissions = tx(() => db.prepare('DELETE FROM submissions').run());
// Same person, same form, twice inside a minute is a double-click or a bot, not two intentions.
function recentDuplicate(type, email, seconds = 60) {
  if (!email) return false;
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  return Boolean(db.prepare('SELECT 1 FROM submissions WHERE type = ? AND email = ? AND created_at > ? LIMIT 1').get(type, email, since));
}

/* ---------- Stats ---------- */

function stats() {
  return db.prepare('SELECT key, label, used_on AS usedOn, value, source, signed_off AS signedOff, updated_at AS updatedAt, signed_off_by AS signedOffBy FROM stats ORDER BY rowid').all()
    .map((row) => ({ ...row, signedOff: Boolean(row.signedOff) }));
}
const saveStat = tx((metric) => {
  db.prepare(`UPDATE stats SET value = ?, source = ?, signed_off = ?, updated_at = ?, signed_off_by = ? WHERE key = ?`)
    .run(metric.value, metric.source, metric.signedOff ? 1 : 0, metric.updatedAt, metric.signedOffBy || '', metric.key);
  const row = db.prepare('SELECT key, label, used_on AS usedOn, value, source, signed_off AS signedOff, updated_at AS updatedAt, signed_off_by AS signedOffBy FROM stats WHERE key = ?').get(metric.key);
  // SQLite has no boolean type; hand back the same shape stats() does, not a raw 0/1.
  return { ...row, signedOff: Boolean(row.signedOff) };
});

/* ---------- Content ---------- */

function collection(name) {
  return db.prepare('SELECT doc FROM content WHERE collection = ? ORDER BY position, rowid').all(name).map((row) => JSON.parse(row.doc));
}
function contentStatic(key) {
  const row = db.prepare('SELECT doc FROM statics WHERE key = ?').get(key);
  return row ? JSON.parse(row.doc) : [];
}
const saveItem = tx((name, item, position = 0) => {
  db.prepare('INSERT INTO content (collection, slug, position, doc) VALUES (?, ?, ?, ?) ON CONFLICT (collection, slug) DO UPDATE SET doc = excluded.doc')
    .run(name, item.slug, position, JSON.stringify(item));
  return item;
});
const deleteItem = tx((name, slug) => db.prepare('DELETE FROM content WHERE collection = ? AND slug = ?').run(name, slug));

/* ---------- Settings ---------- */

function settingsRaw() {
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((row) => [row.key, row.value]));
}
const saveSettings = tx((values) => {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(values)) stmt.run(key, value);
});

/* ---------- Outbox ---------- */

const addMessage = tx((message) => {
  db.prepare('INSERT INTO outbox (id, created_at, recipient, subject, body, status, attempts, error, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(message.id, message.createdAt, message.to, message.subject, message.body, message.status, message.attempts, message.error || '', message.sentAt || '');
});
function outbox(limit = 200) {
  return db.prepare('SELECT id, created_at AS createdAt, recipient AS "to", subject, body, status, attempts, error, sent_at AS sentAt FROM outbox ORDER BY created_at DESC LIMIT ?').all(limit);
}
const updateMessage = tx((message) => {
  db.prepare('UPDATE outbox SET status = ?, attempts = ?, error = ?, sent_at = ? WHERE id = ?')
    .run(message.status, message.attempts, message.error || '', message.sentAt || '', message.id);
});
const clearOutbox = tx(() => db.prepare('DELETE FROM outbox').run());

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
const users = () => db.prepare('SELECT id, email, name, role, created_at AS createdAt, last_login AS lastLogin FROM users ORDER BY created_at').all();
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const userByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
const addUser = tx((email, name, role, password) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, String(email).toLowerCase(), name, role, hashPassword(password), new Date().toISOString());
  return id;
});
const setPassword = tx((id, password) => db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id));
const setUserRole = tx((id, role) => db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id));
const removeUser = tx((id) => db.prepare('DELETE FROM users WHERE id = ?').run(id));
const touchLogin = tx((id) => db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), id));

const createSession = tx((userId, life) => {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + life);
  return token;
});
function sessionUser(token) {
  const row = db.prepare(`SELECT u.id, u.email, u.name, u.role, s.expires_at AS expiresAt
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expiresAt < Date.now()) { dropSession(token); return null; }
  return row;
}
const dropSession = tx((token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
const dropExpiredSessions = tx(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()));

/* ---------- Analytics ---------- */
// Counts only. No cookies, no identifiers, no IP addresses — nothing that could identify a visitor.

const recordView = tx((day, pagePath, referrer) => {
  db.prepare(`INSERT INTO pageviews (day, path, referrer, count) VALUES (?, ?, ?, 1)
    ON CONFLICT (day, path, referrer) DO UPDATE SET count = count + 1`).run(day, pagePath, referrer);
});
function viewStats(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return {
    total: db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM pageviews WHERE day >= ?').get(since).n,
    pages: db.prepare('SELECT path, SUM(count) AS views FROM pageviews WHERE day >= ? GROUP BY path ORDER BY views DESC LIMIT 15').all(since),
    referrers: db.prepare("SELECT referrer, SUM(count) AS views FROM pageviews WHERE day >= ? AND referrer <> '' GROUP BY referrer ORDER BY views DESC LIMIT 10").all(since),
    daily: db.prepare('SELECT day, SUM(count) AS views FROM pageviews WHERE day >= ? GROUP BY day ORDER BY day').all(since)
  };
}

/* ---------- Seeding and migration ---------- */

function seed(seedStats, seedSettings, seedContent) {
  const insertStat = db.prepare('INSERT OR IGNORE INTO stats (key, label, used_on, value, source, signed_off) VALUES (?, ?, ?, ?, ?, ?)');
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const insertItem = db.prepare('INSERT OR IGNORE INTO content (collection, slug, position, doc) VALUES (?, ?, ?, ?)');
  const insertStatic = db.prepare('INSERT OR REPLACE INTO statics (key, doc) VALUES (?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const metric of seedStats) insertStat.run(metric.key, metric.label, metric.usedOn, metric.value, metric.source, metric.signedOff ? 1 : 0);
    for (const entry of seedSettings) insertSetting.run(entry.key, entry.value);
    for (const [name, items] of Object.entries(seedContent)) {
      if (!Array.isArray(items)) continue;
      // Editorial lists with no slug (tiers, spend, topics, faqs) are reference data, not records.
      if (!items.length || !items[0].slug) { insertStatic.run(name, JSON.stringify(items)); continue; }
      items.forEach((item, index) => insertItem.run(name, item.slug, index, JSON.stringify(item)));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

// One-time import of the pre-database JSON files, so nothing collected before the migration is lost.
function importLegacy() {
  const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); } catch { return null; } };
  const imported = { submissions: 0, stats: 0, settings: 0, content: 0, outbox: 0 };
  const legacySubmissions = read('submissions.json');
  if (legacySubmissions?.length && !db.prepare('SELECT 1 FROM submissions LIMIT 1').get()) {
    for (const entry of legacySubmissions) { try { addSubmission(entry); imported.submissions += 1; } catch {} }
  }
  const legacyStats = read('stats.json');
  if (legacyStats?.length) {
    for (const metric of legacyStats) {
      const existing = db.prepare('SELECT signed_off FROM stats WHERE key = ?').get(metric.key);
      if (existing && !existing.signed_off) { saveStat({ ...metric, updatedAt: metric.updatedAt || new Date().toISOString() }); imported.stats += 1; }
    }
  }
  const legacySettings = read('settings.json');
  if (legacySettings?.length) { saveSettings(Object.fromEntries(legacySettings.map((entry) => [entry.key, entry.value]))); imported.settings = legacySettings.length; }
  const legacyContent = read('content.json');
  if (legacyContent) {
    for (const [name, items] of Object.entries(legacyContent)) {
      if (!Array.isArray(items) || !items.length || !items[0].slug) continue;
      items.forEach((item, index) => { saveItem(name, item, index); imported.content += 1; });
    }
  }
  const legacyOutbox = read('outbox.json');
  if (legacyOutbox?.length && !db.prepare('SELECT 1 FROM outbox LIMIT 1').get()) {
    for (const message of legacyOutbox) { try { addMessage(message); imported.outbox += 1; } catch {} }
  }
  const done = Object.values(imported).some(Boolean);
  if (done) {
    const archive = path.join(dataDir, 'legacy-json');
    fs.mkdirSync(archive, { recursive: true });
    for (const name of ['submissions.json', 'stats.json', 'settings.json', 'content.json', 'outbox.json']) {
      const from = path.join(dataDir, name);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(archive, name));
    }
  }
  return done ? imported : null;
}

/* ---------- Backups ---------- */

function backup(keep = 14) {
  fs.mkdirSync(backupDir, { recursive: true });
  // Fold the write-ahead log into the main file first so the copy is a complete database.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(backupDir, `synthavia-${stamp}.db`);
  fs.copyFileSync(dbFile, target);
  const old = fs.readdirSync(backupDir).filter((name) => name.endsWith('.db')).sort().slice(0, -keep);
  for (const name of old) fs.unlinkSync(path.join(backupDir, name));
  return { file: path.basename(target), bytes: fs.statSync(target).size, kept: Math.min(keep, fs.readdirSync(backupDir).length) };
}

module.exports = {
  db, dataDir, backupDir,
  addSubmission, submissions, clearSubmissions, recentDuplicate,
  stats, saveStat,
  collection, contentStatic, saveItem, deleteItem,
  settingsRaw, saveSettings,
  addMessage, outbox, updateMessage, clearOutbox,
  users, userCount, userByEmail, addUser, setPassword, setUserRole, removeUser, touchLogin,
  createSession, sessionUser, dropSession, dropExpiredSessions,
  recordView, viewStats,
  hashPassword, verifyPassword,
  seed, importLegacy, backup
};
