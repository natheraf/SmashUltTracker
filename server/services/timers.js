import { nowIso } from '../db.js';

export const TARGET_WINS = 50;

/** Live elapsed seconds for a timer row (accumulated + current run segment). */
export function elapsedSeconds(row, now = Date.now()) {
  if (!row) return 0;
  const base = row.accumulated_seconds || 0;
  if (!row.running_since) return base;
  return base + Math.max(0, Math.floor((now - Date.parse(row.running_since)) / 1000));
}

/**
 * Stops the current run segment, folding elapsed time into accumulated_seconds.
 * `at` defaults to now; the finalize job passes the last-heartbeat time so a
 * dead tracker freezes at its real stop point, not at detection time.
 */
export function freezeTimer(db, table, keyCols, keyVals, at = nowIso()) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE ${keyCols.map((c) => `${c} = ?`).join(' AND ')}`)
    .get(...keyVals);
  if (!row || !row.running_since) return;
  const atMs = Date.parse(at);
  const startMs = Date.parse(row.running_since);
  const add = Math.max(0, Math.floor((atMs - startMs) / 1000));
  db.prepare(
    `UPDATE ${table}
     SET accumulated_seconds = accumulated_seconds + ?, running_since = NULL, updated_at = ?
     WHERE ${keyCols.map((c) => `${c} = ?`).join(' AND ')}`,
  ).run(add, nowIso(), ...keyVals);
}

/** Opens a run segment at `at` if allowed (not paused, mode+selection active). */
export function startTimerIfActive(db, table, keyCols, keyVals, at = nowIso()) {
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE ${keyCols.map((c) => `${c} = ?`).join(' AND ')}`)
    .get(...keyVals);
  if (!row || row.paused || row.running_since) return;
  db.prepare(
    `UPDATE ${table} SET running_since = ?, updated_at = ? WHERE ${keyCols.map((c) => `${c} = ?`).join(' AND ')}`,
  ).run(at, nowIso(), ...keyVals);
}

/** Recomputes zero_since from wins (non-zero wins clear it). */
export function syncZeroSince(db, streamerId, characterId, wins, at = nowIso()) {
  if (wins > 0) {
    db.prepare(
      `UPDATE streak_progress SET zero_since = NULL
       WHERE streamer_id = ? AND character_id = ?`,
    ).run(streamerId, characterId);
  } else {
    db.prepare(
      `UPDATE streak_progress SET zero_since = COALESCE(zero_since, ?)
       WHERE streamer_id = ? AND character_id = ?`,
    ).run(at, streamerId, characterId);
  }
}

/**
 * Whether a streamer currently counts as "in progress" (drives the home page):
 * tracker sent a heartbeat within the last 5 minutes AND (the run has at least
 * 1 win OR has been at zero wins for under 5 minutes). For streak mode this is
 * evaluated on the selected character; for Ironman on the active run.
 */
export function isStreamerInProgress(db, streamerId, now = Date.now()) {
  const ts = db
    .prepare('SELECT * FROM tracker_sessions WHERE streamer_id = ?')
    .get(streamerId);
  if (!ts || !ts.last_heartbeat) return false;
  if (now - Date.parse(ts.last_heartbeat) > ACTIVE_WINDOW_MS) return false;

  if (ts.active_mode === 'streak') {
    if (!ts.selected_character_id) return false;
    const row = db
      .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
      .get(streamerId, ts.selected_character_id);
    if (!row) return false;
    if (row.wins >= 1) return true;
    return Boolean(row.zero_since) && now - Date.parse(row.zero_since) < ZERO_WINDOW_MS;
  }

  const run = db
    .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
    .get(streamerId);
  if (!run) return false;
  const won = db
    .prepare("SELECT COUNT(*) AS n FROM ironman_entries WHERE run_id = ? AND status = 'won'")
    .get(run.id).n;
  if (won >= 1) return true;
  return Boolean(run.zero_since) && now - Date.parse(run.zero_since) < ZERO_WINDOW_MS;
}

// The tracker posts a heartbeat every 30s; a tracker is active if heard from
// within the last 5 minutes. Timers of stale sessions are frozen after 2 missed
// heartbeats by the background job.
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ACTIVE_WINDOW_MS = 5 * 60_000;
export const TIMER_STALE_MS = 2 * 60_000;
export const ZERO_WINDOW_MS = 5 * 60_000;

/** Touches the heartbeat as part of every tracker action. */
export function touchHeartbeat(db, streamerId, at = nowIso()) {
  db.prepare(
    `INSERT INTO tracker_sessions (streamer_id, last_heartbeat, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(streamer_id) DO UPDATE SET last_heartbeat = excluded.last_heartbeat, updated_at = excluded.updated_at`,
  ).run(streamerId, at, nowIso());
}
