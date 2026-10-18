import { Router } from 'express';
import { openSseStream } from '../services/sseStream.js';

/**
 * Public update stream. Clients receive "dirty pokes" and refetch whatever
 * they display, so payloads stay tiny and clients can't drift.
 *
 *   data: {"type":"tracker","streamerId":3}
 *   data: {"type":"timeline","streamerId":3}
 *   data: {"type":"submissions"} / {"type":"votes"} / {"type":"ironman"}
 */
export function sseRoutes() {
  const router = Router();
  router.get('/stream', (req, res) => openSseStream(req, res));
  return router;
}
