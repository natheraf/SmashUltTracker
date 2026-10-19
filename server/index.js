import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb, runMigrations } from './db.js';
import { bootstrapAdmin, seedCharacters, seedRoles } from './seedData.js';
import { startFinalizeJob } from './jobs/finalizeTimers.js';
import { startVoteWinnerJob } from './jobs/voteWinners.js';

const config = loadConfig();
const db = openDb(config.dataDir);
runMigrations(db);
seedRoles(db);
seedCharacters(db);
bootstrapAdmin(db, config);
startFinalizeJob(db);
startVoteWinnerJob(db);

const app = createApp({ db, config });
const server = app.listen(config.port, () => {
  console.log(`[boot] SmashUltTracker listening on http://localhost:${config.port} (data: ${config.dataDir})`);
});

function shutdown(signal) {
  console.log(`[boot] ${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Force-exit if connections refuse to drain.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
