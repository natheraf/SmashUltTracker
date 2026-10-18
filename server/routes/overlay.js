import { Router } from 'express';
import { buildOverlayState } from '../services/overlay.js';
import { openSseStream } from '../services/sseStream.js';

/**
 * Public overlay API, authorised by the streamer's capability token (a random
 * 24-char string in the /overlay/<token> URL). It exposes only what a stream
 * overlay shows, and never the token itself.
 */
export function overlayRoutes(db) {
  const router = Router();

  const findByToken = db.prepare('SELECT streamer_id FROM tracker_sessions WHERE overlay_token = ?');

  router.get('/:token/state', (req, res) => {
    const row = findByToken.get(req.params.token);
    const state = row ? buildOverlayState(db, row.streamer_id) : null;
    if (!state) return res.status(404).json({ error: 'not_found', message: 'Unknown overlay token' });
    res.set('Cache-Control', 'no-store');
    res.json({ state });
  });

  router.get('/:token/stream', (req, res) => {
    const row = findByToken.get(req.params.token);
    if (!row) return res.status(404).json({ error: 'not_found', message: 'Unknown overlay token' });
    const streamerId = row.streamer_id;
    openSseStream(req, res, {
      // Pokes aimed at this streamer, plus streamer-agnostic ones.
      filter: (event) => !event.streamerId || event.streamerId === streamerId,
    });
  });

  return router;
}
