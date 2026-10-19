import { runView } from './ironman.js';
import { getPrimaryStreamerId } from './settings.js';
import {
  ACTIVE_WINDOW_MS,
  elapsedSeconds,
  isStreamerInProgress,
  TARGET_WINS,
  ZERO_WINDOW_MS,
} from './timers.js';

/**
 * Everything the public home page shows: who is live right now, one streamer's
 * grid state, per-character detail, and the community timeline. All of it is
 * read-only and needs no session.
 */

const STREAMER_COLUMNS = `u.id, u.username, u.display_name, u.youtube_url, u.twitch_url`;

/** Streamers appear on the home page once an admin approves them. */
export function listStreamers(db) {
  return db
    .prepare(
      `SELECT DISTINCT ${STREAMER_COLUMNS}
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'streamer' AND u.status = 'approved'
       ORDER BY u.id`,
    )
    .all();
}

/** First approved streamer — the default when no primary is configured. */
export function defaultPrimaryStreamerId(db) {
  const row = db
    .prepare(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'streamer' AND u.status = 'approved'
       ORDER BY u.id LIMIT 1`,
    )
    .get();
  return row ? row.id : null;
}

/** The configured primary streamer, or the first approved one. */
export function primaryStreamerId(db) {
  return getPrimaryStreamerId(db) ?? defaultPrimaryStreamerId(db);
}

/**
 * Mirrors the tracker's in-progress rule for reads that don't have a single
 * context yet: a heartbeat in the last 5 minutes AND (1+ win OR under 5
 * minutes at zero wins).
 */
function isLive({ lastHeartbeat, wins, zeroSince }, now) {
  if (!lastHeartbeat || now - Date.parse(lastHeartbeat) > ACTIVE_WINDOW_MS) return false;
  if (wins >= 1) return true;
  return Boolean(zeroSince) && now - Date.parse(zeroSince) < ZERO_WINDOW_MS;
}

/** The home page's landing payload: live streak cards + active Ironman runs. */
export function homeSnapshot(db, now = Date.now()) {
  const primaryStreamer = primaryStreamerId(db);

  const streaks = db
    .prepare(
      `SELECT ts.streamer_id, ts.selected_character_id, ts.last_heartbeat,
              u.display_name, u.youtube_url, u.twitch_url,
              sp.accumulated_seconds, sp.running_since, sp.paused, sp.zero_since,
              COALESCE(sp.wins, 0) AS wins,
              c.slug, c.name
       FROM tracker_sessions ts
       JOIN users u ON u.id = ts.streamer_id AND u.status = 'approved'
       LEFT JOIN streak_progress sp
         ON sp.streamer_id = ts.streamer_id AND sp.character_id = ts.selected_character_id
       LEFT JOIN characters c ON c.id = ts.selected_character_id
       WHERE ts.active_mode = 'streak' AND ts.selected_character_id IS NOT NULL`,
    )
    .all()
    .filter((row) => isLive({ lastHeartbeat: row.last_heartbeat, wins: row.wins, zeroSince: row.zero_since }, now))
    .map((row) => ({
      streamer_id: row.streamer_id,
      display_name: row.display_name,
      youtube_url: row.youtube_url,
      twitch_url: row.twitch_url,
      character: { id: row.selected_character_id, slug: row.slug, name: row.name },
      wins: row.wins,
      target: TARGET_WINS,
      elapsed_seconds: elapsedSeconds(row, now),
      running: Boolean(row.running_since),
      paused: Boolean(row.paused),
    }));

  const ironman = db
    .prepare(
      `SELECT r.*, ts.last_heartbeat, u.display_name, u.youtube_url, u.twitch_url
       FROM ironman_runs r
       JOIN users u ON u.id = r.streamer_id AND u.status = 'approved'
       LEFT JOIN tracker_sessions ts ON ts.streamer_id = r.streamer_id
       WHERE r.status = 'active'
       ORDER BY r.id`,
    )
    .all()
    .map((row) => {
      const won = db
        .prepare("SELECT COUNT(*) AS n FROM ironman_entries WHERE run_id = ? AND status = 'won'")
        .get(row.id).n;
      return { run: row, won: won };
    })
    .filter(({ run, won }) =>
      isLive({ lastHeartbeat: run.last_heartbeat, wins: won, zeroSince: run.zero_since }, now),
    )
    .map(({ run, won }) => {
      const drawn = db
        .prepare(
          `SELECT c.id, c.slug, c.name FROM ironman_entries e
           JOIN characters c ON c.id = e.character_id
           WHERE e.run_id = ? AND e.status = 'drawn'`,
        )
        .get(run.id);
      const total = db
        .prepare('SELECT COUNT(*) AS n FROM ironman_entries WHERE run_id = ?')
        .get(run.id).n;
      return {
        streamer_id: run.streamer_id,
        display_name: run.display_name,
        youtube_url: run.youtube_url,
        twitch_url: run.twitch_url,
        run_id: run.id,
        drawn: drawn || null,
        won,
        total,
        elapsed_seconds: elapsedSeconds(run, now),
        running: Boolean(run.running_since),
        paused: Boolean(run.paused),
      };
    });

  return { primary_streamer_id: primaryStreamer, streamers: listStreamers(db), streaks, ironman };
}

/** One streamer's grid: live flag, partial streaks, completions, Ironman run. */
export function streamerProgress(db, streamerId, now = Date.now()) {
  const streamer = db
    .prepare(
      `SELECT ${STREAMER_COLUMNS}, u.status
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.name = 'streamer'
       WHERE u.id = ?`,
    )
    .get(streamerId);
  if (!streamer) return null;

  const streaks = db
    .prepare(
      `SELECT sp.character_id, sp.wins, sp.accumulated_seconds, sp.running_since, sp.paused,
              sp.milestones_reached
       FROM streak_progress sp
       JOIN characters c ON c.id = sp.character_id
       WHERE sp.streamer_id = ? ORDER BY c.select_order`,
    )
    .all(streamerId)
    .map((row) => ({
      character_id: row.character_id,
      wins: row.wins,
      elapsed_seconds: elapsedSeconds(row, now),
      running: Boolean(row.running_since),
      paused: Boolean(row.paused),
      milestones_reached: row.milestones_reached,
    }));

  const completions = db
    .prepare(
      `SELECT character_id, completed_at, duration_seconds, attempts_count
       FROM completions WHERE streamer_id = ? ORDER BY completed_at`,
    )
    .all(streamerId);

  const ts = db.prepare('SELECT * FROM tracker_sessions WHERE streamer_id = ?').get(streamerId);
  const run = db
    .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
    .get(streamerId);
  const view = run ? runView(db, run, now) : null;

  return {
    streamer,
    live: isStreamerInProgress(db, streamerId, now),
    mode: ts?.active_mode || 'streak',
    selected_character_id: ts?.selected_character_id || null,
    last_heartbeat: ts?.last_heartbeat || null,
    streaks,
    completions,
    ironman: view
      ? {
          run_id: view.id,
          status: view.status,
          total: view.total,
          won_count: view.won_count,
          lost_count: view.lost_count,
          elapsed_seconds: view.elapsed_seconds,
          running: view.running,
          paused: view.paused,
          current_draw: view.current_draw,
          won_ids: view.entries.filter((e) => e.status === 'won').map((e) => e.character_id),
        }
      : null,
  };
}

/**
 * Per-character detail for the home page dialog: how the streamer has done on
 * that fighter, and the approved VODs of the completion.
 */
export function characterDetail(db, streamerId, characterId, now = Date.now()) {
  const streamer = db
    .prepare(`SELECT id, display_name, youtube_url, twitch_url FROM users WHERE id = ?`)
    .get(streamerId);
  const character = db
    .prepare('SELECT id, slug, name, series, is_dlc, is_echo FROM characters WHERE id = ?')
    .get(characterId);
  if (!streamer || !character) return null;

  const row = db
    .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);
  const completion = db
    .prepare(
      `SELECT completed_at, duration_seconds, attempts_count
       FROM completions WHERE streamer_id = ? AND character_id = ?`,
    )
    .get(streamerId, characterId);

  const attempts = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(MAX(wins), 0) AS best_wins,
              COALESCE(SUM(result = 'failed'), 0) AS failed,
              COALESCE(SUM(result = 'completed'), 0) AS completed,
              COALESCE(SUM(result = 'reset'), 0) AS reset,
              COALESCE(SUM(duration_seconds), 0) AS total_seconds
       FROM attempts WHERE streamer_id = ? AND character_id = ?`,
    )
    .get(streamerId, characterId);

  const recent = db
    .prepare(
      `SELECT wins, duration_seconds, result, ended_at FROM attempts
       WHERE streamer_id = ? AND character_id = ? ORDER BY id DESC LIMIT 5`,
    )
    .all(streamerId, characterId);

  const vods = db
    .prepare(
      `SELECT video_id, youtube_url, title, thumbnail, start_timestamp, completion_date, created_at
       FROM vod_submissions
       WHERE streamer_id = ? AND character_id = ? AND status = 'approved'
       ORDER BY id`,
    )
    .all(streamerId, characterId);

  const streakWins = row?.wins || 0;
  return {
    streamer: { id: streamer.id, display_name: streamer.display_name },
    character,
    streak: row
      ? {
          wins: streakWins,
          elapsed_seconds: elapsedSeconds(row, now),
          running: Boolean(row.running_since),
          paused: Boolean(row.paused),
          milestones_reached: row.milestones_reached,
        }
      : null,
    completion: completion || null,
    best_streak: Math.max(attempts.best_wins, streakWins),
    attempts: {
      count: attempts.count,
      best_wins: attempts.best_wins,
      failed: attempts.failed,
      completed: attempts.completed,
      reset: attempts.reset,
      total_seconds: attempts.total_seconds,
    },
    recent_attempts: recent,
    vods: vods.map((vod) => ({
      video_id: vod.video_id,
      youtube_url: vod.youtube_url,
      title: vod.title,
      thumbnail: vod.thumbnail,
      start_timestamp: vod.start_timestamp,
      completion_date: vod.completion_date,
      approved_at: vod.created_at,
    })),
  };
}

/** Newest-first timeline page; `before` is the id cursor for the next page. */
export function timelinePage(db, { before = null, limit = 20 } = {}) {
  const size = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const cursor = Number.isInteger(Number(before)) && Number(before) > 0 ? Number(before) : null;
  const rows = db
    .prepare(
      `SELECT t.id, t.type, t.payload, t.created_at,
              u.id AS streamer_id, u.display_name,
              t.character_id, c.slug, c.name AS character_name
       FROM timeline_events t
       LEFT JOIN users u ON u.id = t.streamer_id
       LEFT JOIN characters c ON c.id = t.character_id
       WHERE (? IS NULL OR t.id < ?)
       ORDER BY t.id DESC
       LIMIT ?`,
    )
    .all(cursor, cursor, size);

  return {
    events: rows.map((row) => ({
      id: row.id,
      type: row.type,
      created_at: row.created_at,
      streamer: row.streamer_id ? { id: row.streamer_id, display_name: row.display_name } : null,
      character: row.character_id
        ? { id: row.character_id, slug: row.slug, name: row.character_name }
        : null,
      payload: row.payload ? JSON.parse(row.payload) : null,
    })),
    next_before: rows.length === size ? rows[rows.length - 1].id : null,
  };
}
