// Applies migrations without starting the server: npm run migrate
import { loadConfig } from '../server/config.js';
import { openDb, runMigrations } from '../server/db.js';

const config = loadConfig();
const db = openDb(config.dataDir);
runMigrations(db);
const applied = db.prepare('SELECT name FROM schema_migrations ORDER BY name').all();
console.log(`Migrations applied (${applied.length}):`);
for (const row of applied) console.log(`  ${row.name}`);
db.close();
