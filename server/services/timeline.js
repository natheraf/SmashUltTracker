import { nowIso } from '../db.js';
import { broadcast } from './bus.js';

/**
 * Records a viewer-facing timeline event. Types:
 *   completion, ironman_started, ironman_failed, ironman_completed,
 *   streak_failed, milestone, vod_approved, vote_winner, streamer_joined
 */
export function addTimelineEvent(db, { type, streamerId = null, characterId = null, payload = null }) {
  const info = db
    .prepare(
      `INSERT INTO timeline_events (type, streamer_id, character_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(type, streamerId, characterId, payload ? JSON.stringify(payload) : null, nowIso());
  broadcast('timeline', { streamerId, characterId });
  return info.lastInsertRowid;
}
