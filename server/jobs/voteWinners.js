import { recordDailyWinners } from '../services/votes.js';

const INTERVAL_MS = 15 * 60_000;

/**
 * Snapshots finished UTC days into vote_daily_winners, which is what puts the
 * daily "who's next?" winner on the timeline exactly once. The read path calls
 * the same idempotent service, so a missed tick only delays the event, never
 * duplicates it.
 */
export function startVoteWinnerJob(db) {
  const run = () => {
    try {
      const recorded = recordDailyWinners(db);
      if (recorded) console.log(`[votes] recorded ${recorded} daily winner(s)`);
    } catch (err) {
      console.error('[votes] daily winner snapshot failed', err);
    }
  };

  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
