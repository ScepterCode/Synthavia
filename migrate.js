// One-off schema creation and seeding. Run before the first boot and after any schema change:
//
//   npm run migrate
//
// Kept out of the application's startup path deliberately: on serverless every cold start would
// otherwise open a session-pooler connection to run DDL, and Supabase allows very few of those.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./db.js');

const seedStats = [
  { key: 'members', label: 'Community members', usedOn: 'Home stats bar, impact grid', value: '1,240', source: 'Roster export, Sep 2026', signedOff: true },
  { key: 'editions', label: 'AI of Things editions', usedOn: 'Home stats bar', value: '2', source: 'Event records', signedOff: true },
  { key: 'projects', label: 'Lab projects running', usedOn: 'Home stats bar, Lab index', value: '3', source: 'Project register, Sep 2026', signedOff: true },
  { key: 'trained', label: 'Talents trained', usedOn: 'Impact grid', value: '', source: 'Attendance audit incomplete', signedOff: false },
  { key: 'partners', label: 'Partner organisations', usedOn: 'Impact grid, partners strip', value: '', source: 'No signed MOU', signedOff: false }
];
const seedSettings = [
  { key: 'whatsapp', value: '' },
  { key: 'github', value: '' },
  { key: 'teamEmail', value: 'hello@synthavia.ai' },
  { key: 'programsEmail', value: 'programs@synthavia.ai' },
  { key: 'partnersEmail', value: 'partners@synthavia.ai' }
];

async function main() {
  console.log(`Schema: ${store.schema}`);
  await store.migrate();
  console.log('Tables created (or already present).');
  const seedContent = JSON.parse(fs.readFileSync(path.join(__dirname, 'content.json'), 'utf8'));
  await store.seed(seedStats, seedSettings, seedContent);
  const counts = {};
  for (const name of ['posts', 'events', 'projects', 'programs', 'team', 'resources']) counts[name] = (await store.collection(name)).length;
  console.log('Seeded content:', counts);
  console.log('Accounts:', await store.userCount());
  await store.close();
}

main().catch((error) => { console.error('Migration failed:', error.message); process.exit(1); });
