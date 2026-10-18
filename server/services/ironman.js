import crypto from 'node:crypto';
import { nowIso } from '../db.js';
import { badRequest } from '../errors.js';
import { addTimelineEvent } from './timeline.js';
import { elapsedSeconds, freezeTimer } from './timers.js';

/**
 * Ironman mode (nairomk's rules):
 *   - a run draws random characters from the full roster, one at a time
 *   - a draw is final: no rerolls, and it persists until it is resolved
 *   - one win with the drawn character marks it "won"
 *   - one loss ends the whole run ("failed", hardcore)
 *   - the run completes when every character has been won with
 *
 * Every character is inserted as a `pending` entry when the run starts, which
 * makes the remaining pool explicit and lets the client show a full-deck view.
 */

export function activeRun(db, streamerId) {
  return db
    .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
    .get(streamerId);
}

/** Starts a run and lays out the full roster as the deck. */
export function createRun(db, streamerId, at = nowIso()) {
  const existing = activeRun(db, streamerId);
  if (existing) throw badRequest('A run is already active', 'run_active');

  const info = db
    .prepare(
      `INSERT INTO ironman_runs (streamer_id, status, started_at, running_since, paused, zero_since)
       VALUES (?, 'active', ?, ?, 0, ?)`,
    )
    .run(streamerId, at, at, at);
  const runId = Number(info.lastInsertRowid);

  const insert = db.prepare(
    `INSERT INTO ironman_entries (run_id, character_id, status)
     SELECT ?, id, 'pending' FROM characters ORDER BY select_order`,
  );
  insert.run(runId);

  addTimelineEvent(db, { type: 'ironman_started', streamerId, payload: { run_id: runId } });
  return db.prepare('SELECT * FROM ironman_runs WHERE id = ?').get(runId);
}

/** Draws one random pending character. The draw is final until resolved. */
export function drawNext(db, runId) {
  const drawn = db
    .prepare("SELECT id FROM ironman_entries WHERE run_id = ? AND status = 'drawn'")
    .get(runId);
  if (drawn) throw badRequest('A character is already drawn', 'draw_pending');

  const pending = db
    .prepare("SELECT id FROM ironman_entries WHERE run_id = ? AND status = 'pending' ORDER BY id")
    .all(runId);
  if (pending.length === 0) throw badRequest('The pool is empty', 'pool_empty');

  // crypto.randomInt is uniform over [0, n) — no modulo bias.
  const picked = pending[crypto.randomInt(pending.length)];
  const drawOrder = db
    .prepare('SELECT COALESCE(MAX(draw_order), 0) + 1 AS n FROM ironman_entries WHERE run_id = ?')
    .get(runId).n;
  db.prepare("UPDATE ironman_entries SET status = 'drawn', draw_order = ? WHERE id = ?").run(
    drawOrder,
    picked.id,
  );
  return db
    .prepare(
      `SELECT ie.*, c.slug, c.name FROM ironman_entries ie
       JOIN characters c ON c.id = ie.character_id WHERE ie.id = ?`,
    )
    .get(picked.id);
}

/** Current drawn entry, or a 400 when nothing is drawn. */
export function requireDrawnEntry(db, runId) {
  const entry = db
    .prepare(
      `SELECT ie.*, c.slug, c.name FROM ironman_entries ie
       JOIN characters c ON c.id = ie.character_id
       WHERE ie.run_id = ? AND ie.status = 'drawn'`,
    )
    .get(runId);
  if (!entry) throw badRequest('Draw a character first', 'no_draw');
  return entry;
}

/** Wins the drawn character; completes the run when the deck is exhausted. */
export function winDraw(db, run, at = nowIso()) {
  const entry = requireDrawnEntry(db, run.id);
  db.prepare("UPDATE ironman_entries SET status = 'won', won_at = ? WHERE id = ?").run(at, entry.id);
  db.prepare('UPDATE ironman_runs SET zero_since = NULL WHERE id = ?').run(run.id);

  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM ironman_entries WHERE run_id = ? AND status != 'won'")
    .get(run.id).n;
  if (remaining === 0) return { entry, completed: true, run: completeRun(db, run, at) };
  return { entry, completed: false, run: db.prepare('SELECT * FROM ironman_runs WHERE id = ?').get(run.id) };
}

/** Loses the drawn character — hardcore: the run is over. */
export function loseDraw(db, run, at = nowIso()) {
  const entry = requireDrawnEntry(db, run.id);
  db.prepare("UPDATE ironman_entries SET status = 'lost' WHERE id = ?").run(entry.id);
  freezeTimer(db, 'ironman_runs', ['id'], [run.id], at);
  db.prepare("UPDATE ironman_runs SET status = 'failed', ended_at = ?, running_since = NULL WHERE id = ?").run(
    at,
    run.id,
  );
  const won = db
    .prepare("SELECT COUNT(*) AS n FROM ironman_entries WHERE run_id = ? AND status = 'won'")
    .get(run.id).n;
  addTimelineEvent(db, {
    type: 'ironman_failed',
    streamerId: run.streamer_id,
    characterId: entry.character_id,
    payload: { won, character: entry.name, run_id: run.id },
  });
  return db.prepare('SELECT * FROM ironman_runs WHERE id = ?').get(run.id);
}

/** Ends a run without a loss (streamer stops or calls it done). */
export function abandonRun(db, run, at = nowIso()) {
  freezeTimer(db, 'ironman_runs', ['id'], [run.id], at);
  db.prepare("UPDATE ironman_runs SET status = 'failed', ended_at = ?, running_since = NULL WHERE id = ?").run(
    at,
    run.id,
  );
  return db.prepare('SELECT * FROM ironman_runs WHERE id = ?').get(run.id);
}

function completeRun(db, run, at) {
  freezeTimer(db, 'ironman_runs', ['id'], [run.id], at);
  db.prepare("UPDATE ironman_runs SET status = 'completed', ended_at = ?, running_since = NULL WHERE id = ?").run(
    at,
    run.id,
  );
  addTimelineEvent(db, {
    type: 'ironman_completed',
    streamerId: run.streamer_id,
    payload: { duration_seconds: elapsedSeconds(run, Date.parse(at)), run_id: run.id },
  });
  return db.prepare('SELECT * FROM ironman_runs WHERE id = ?').get(run.id);
}

/** Run plus deck state, shaped for the tracker UI and the overlay. */
export function runView(db, run, now = Date.now()) {
  if (!run) return null;
  const entries = db
    .prepare(
      `SELECT ie.*, c.slug, c.name FROM ironman_entries ie
       JOIN characters c ON c.id = ie.character_id
       WHERE ie.run_id = ? ORDER BY COALESCE(ie.draw_order, 999999), ie.id`,
    )
    .all(run.id);
  const drawnEntry = entries.find((entry) => entry.status === 'drawn') || null;
  const won = entries.filter((entry) => entry.status === 'won');
  const lost = entries.filter((entry) => entry.status === 'lost');
  return {
    id: run.id,
    status: run.status,
    started_at: run.started_at,
    ended_at: run.ended_at,
    elapsed_seconds: elapsedSeconds(run, now),
    running: Boolean(run.running_since),
    paused: Boolean(run.paused),
    total: entries.length,
    won_count: won.length,
    lost_count: lost.length,
    zero_since: run.zero_since,
    current_draw: drawnEntry
      ? { entry_id: drawnEntry.id, character_id: drawnEntry.character_id, slug: drawnEntry.slug, name: drawnEntry.name }
      : null,
    entries: entries.map((entry) => ({
      entry_id: entry.id,
      character_id: entry.character_id,
      slug: entry.slug,
      name: entry.name,
      status: entry.status,
      draw_order: entry.draw_order,
    })),
  };
}

/** Finished runs, newest first — the tracker's Ironman history list. */
export function runHistory(db, streamerId, limit = 10) {
  return db
    .prepare(
      `SELECT r.id, r.status, r.started_at, r.ended_at, r.accumulated_seconds,
              (SELECT COUNT(*) FROM ironman_entries e WHERE e.run_id = r.id AND e.status = 'won') AS won_count,
              (SELECT COUNT(*) FROM ironman_entries e WHERE e.run_id = r.id) AS total
       FROM ironman_runs r
       WHERE r.streamer_id = ? AND r.status != 'active'
       ORDER BY COALESCE(r.ended_at, r.started_at) DESC
       LIMIT ?`,
    )
    .all(streamerId, limit)
    .map((row) => ({
      id: row.id,
      status: row.status,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_seconds: row.accumulated_seconds,
      won_count: row.won_count,
      total: row.total,
    }));
}
