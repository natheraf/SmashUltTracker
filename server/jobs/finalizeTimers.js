import { nowIso } from '../db.js';
import { freezeTimer, startTimerIfActive, TIMER_STALE_MS } from '../services/timers.js';
import { broadcast } from '../services/bus.js';

/**
 * Freezes timers of trackers that stopped heartbeating, at their last
 * heartbeat (not at detection time — a tracker that died at 10:00:30 with a
 * 10:00:00 heartbeat gets frozen at 10:00:00). When the tracker returns, the
 * heartbeat handler reopens the timer, so the gap simply never counted.
 */
export function finalizeStaleTimers(db, now = Date.now()) {
  const cutoff = new Date(now - TIMER_STALE_MS).toISOString();
  const stale = db
    .prepare(
      `SELECT * FROM tracker_sessions
       WHERE last_heartbeat IS NOT NULL AND last_heartbeat < ?`,
    )
    .all(cutoff);
  if (!stale.length) return 0;

  let frozen = 0;
  for (const ts of stale) {
    if (ts.active_mode === 'streak' && ts.selected_character_id) {
      const row = db
        .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
        .get(ts.streamer_id, ts.selected_character_id);
      if (row?.running_since) {
        freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [ts.streamer_id, ts.selected_character_id], ts.last_heartbeat);
        frozen++;
      }
    } else if (ts.active_mode === 'ironman') {
      const run = db
        .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
        .get(ts.streamer_id);
      if (run?.running_since) {
        freezeTimer(db, 'ironman_runs', ['id'], [run.id], ts.last_heartbeat);
        frozen++;
      }
    }
  }
  if (frozen > 0) {
    broadcast('tracker', { reason: 'timer_finalized' });
    db.prepare('UPDATE tracker_sessions SET updated_at = ? WHERE last_heartbeat < ?').run(nowIso(), cutoff);
  }
  return frozen;
}

/** Starts the periodic job; returns a stop function. */
export function startFinalizeJob(db, { intervalMs = 30_000 } = {}) {
  const timer = setInterval(() => {
    try {
      finalizeStaleTimers(db);
    } catch (err) {
      console.error('[jobs] finalizeStaleTimers failed', err);
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export { startTimerIfActive };
