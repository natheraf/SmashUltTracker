import { elapsedSeconds, isStreamerInProgress } from './timers.js';

/**
 * Compact payload for the public overlay. The overlay token is the only
 * credential, so this exposes only what is on stream: character, progress,
 * timer state and the streamer's display name.
 */
export function buildOverlayState(db, streamerId, now = Date.now()) {
  const streamer = db
    .prepare('SELECT id, username, display_name FROM users WHERE id = ?')
    .get(streamerId);
  if (!streamer) return null;

  const ts = db.prepare('SELECT * FROM tracker_sessions WHERE streamer_id = ?').get(streamerId);
  const mode = ts?.active_mode || 'streak';
  const base = {
    streamer: { display_name: streamer.display_name, username: streamer.username },
    mode,
    server_time: new Date(now).toISOString(),
    in_progress: isStreamerInProgress(db, streamerId, now),
  };

  if (mode === 'streak') {
    const characterId = ts?.selected_character_id || null;
    const row = characterId
      ? db.prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?').get(streamerId, characterId)
      : null;
    const character = characterId
      ? db.prepare('SELECT id, slug, name FROM characters WHERE id = ?').get(characterId)
      : null;
    const attempts = character
      ? db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE streamer_id = ? AND character_id = ?').get(streamerId, characterId).n + 1
      : 1;
    const best = character
      ? Math.max(
          db.prepare('SELECT COALESCE(MAX(wins), 0) AS b FROM attempts WHERE streamer_id = ? AND character_id = ?').get(streamerId, characterId).b,
          row?.wins || 0,
        )
      : 0;
    return {
      ...base,
      character: character ? { slug: character.slug, name: character.name } : null,
      wins: row?.wins || 0,
      target: 50,
      attempt: attempts,
      best,
      elapsed_seconds: row ? elapsedSeconds(row, now) : 0,
      running: Boolean(row?.running_since),
      paused: Boolean(row?.paused),
      milestones_reached: row?.milestones_reached || 0,
    };
  }

  // Ironman — phase 4 fills in entries; the frame is useful to OBS already.
  const run = db
    .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
    .get(streamerId);
  const entries = run
    ? db
        .prepare(
          `SELECT ie.*, c.slug, c.name FROM ironman_entries ie
           JOIN characters c ON c.id = ie.character_id
           WHERE ie.run_id = ? ORDER BY COALESCE(ie.draw_order, 999999), ie.id`,
        )
        .all(run.id)
    : [];
  return {
    ...base,
    run: run ? { started_at: run.started_at, status: run.status } : null,
    elapsed_seconds: run ? elapsedSeconds(run, now) : 0,
    running: Boolean(run?.running_since),
    paused: Boolean(run?.paused),
    entries: entries.map((e) => ({
      slug: e.slug,
      name: e.name,
      status: e.status,
      imported: Boolean(e.imported),
    })),
    won: entries.filter((e) => e.status === 'won').length,
  };
}
