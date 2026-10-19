import { nowIso } from '../db.js';
import { elapsedSeconds, freezeTimer, syncZeroSince, TARGET_WINS } from './timers.js';
import { addTimelineEvent } from './timeline.js';
import { badRequest } from '../errors.js';

export const MILESTONES = [10, 25, 40];

const MILESTONE_BITS = { 10: 1, 25: 2, 40: 4 };

/**
 * Cumulative milestone bitmask for a win count: reaching a higher milestone
 * implies the lower ones were reached too, so e.g. 30 wins returns 3.
 */
export function milestoneBit(wins) {
  let bits = 0;
  for (const milestone of MILESTONES) {
    if (wins >= milestone) bits |= MILESTONE_BITS[milestone];
  }
  return bits;
}

/**
 * Applies milestone bookkeeping after a win count change. `newWins` is the
 * count *after* the change and `oldWins` the count before it. Returns the
 * milestones newly crossed (for the timeline event), or [] when none. A
 * milestone whose bit is already recorded never fires again, so a correction
 * that dips below a milestone and climbs back does not repeat the event.
 */
export function checkMilestones(db, streak, newWins, oldWins, at = nowIso()) {
  const fired = MILESTONES.filter(
    (m) => newWins >= m && oldWins < m && !(streak.milestones_reached & MILESTONE_BITS[m]),
  );
  if (!fired.length) return [];
  const bits = streak.milestones_reached | milestoneBit(newWins);
  if (bits !== streak.milestones_reached) {
    db.prepare(
      `UPDATE streak_progress SET milestones_reached = ?, updated_at = ?
       WHERE streamer_id = ? AND character_id = ?`,
    ).run(bits, at, streak.streamer_id, streak.character_id);
  }
  return fired;
}

export function recordStreakAttempt(db, streamerId, characterId, wins, durationSeconds, result, at = nowIso()) {
  db.prepare(
    `INSERT INTO attempts (streamer_id, character_id, wins, duration_seconds, result, ended_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(streamerId, characterId, wins, durationSeconds, result, at);
}

/**
 * Clears a streak row and records a keep-first completion at 50 wins.
 * The attempt row is inserted first so attempts_count includes this run.
 * Returns { completed, attemptsCount, durationSeconds }.
 */
export function completeStreak(db, streamerId, characterId, at = nowIso()) {
  const row = db
    .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);
  if (!row) return { completed: false };

  const duration = elapsedSeconds(row, Date.parse(at));
  freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [streamerId, characterId], at);

  const existing = db
    .prepare('SELECT id FROM completions WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);

  if (!existing) {
    // Count this attempt before computing the total, so the completed run is
    // included in attempts_count.
    recordStreakAttempt(db, streamerId, characterId, TARGET_WINS, duration, 'completed', at);
    const attemptsCount = db
      .prepare('SELECT COUNT(*) AS n FROM attempts WHERE streamer_id = ? AND character_id = ?')
      .get(streamerId, characterId).n;
    db.prepare(
      `INSERT INTO completions (streamer_id, character_id, completed_at, duration_seconds, attempts_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(streamerId, characterId, at, duration, attemptsCount, nowIso());
    addTimelineEvent(db, {
      type: 'completion',
      streamerId,
      characterId,
      payload: { attempts: attemptsCount, duration_seconds: duration },
    });
    db.prepare(
      'DELETE FROM streak_progress WHERE streamer_id = ? AND character_id = ?',
    ).run(streamerId, characterId);
    return { completed: true, attemptsCount, durationSeconds: duration };
  }

  // Keep-first: the completion already exists (e.g. approved backfill won the
  // race) — just clear the progress row.
  recordStreakAttempt(db, streamerId, characterId, TARGET_WINS, duration, 'completed', at);
  db.prepare('DELETE FROM streak_progress WHERE streamer_id = ? AND character_id = ?').run(
    streamerId,
    characterId,
  );
  return { completed: false, attemptsCount: 1, durationSeconds: duration };
}

/** Fetches (creating if needed) the streak row for a character. */
export function ensureStreakRow(db, streamerId, characterId, { paused = 0 } = {}) {
  const row = db
    .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);
  if (row) return row;
  db.prepare(
    `INSERT INTO streak_progress (streamer_id, character_id, wins, paused, zero_since, updated_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
  ).run(streamerId, characterId, paused, nowIso(), nowIso());
  return db
    .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);
}

export function requireCharacter(db, characterId) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!char) throw badRequest('Unknown character', 'unknown_character');
  return char;
}
