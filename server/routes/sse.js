import { Router } from 'express';
import { bus } from '../services/bus.js';

/**
 * Public live-update channel. The server sends "dirty pokes" — clients react
 * by refetching the endpoint that owns the data (never full state pushes), so
 * the server stays the single source of truth and payloads stay tiny.
 *
 * Event shapes:
 *   data: {"type":"tracker","streamerId":3}
 *   data: {"type":"timeline","streamerId":3}
 *   data: {"type":"submissions"}
 *   data: {"type":"votes"}
 *   data: {"type":"ironman"}
 */
export function sseRoutes() {
  const router = Router();

  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: never buffer SSE
    });
    res.write(': connected\n\n');

    const onUpdate = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), 20_000);

    bus.on('update', onUpdate);
    req.on('close', () => {
      clearInterval(keepalive);
      bus.off('update', onUpdate);
    });
  });

  return router;
}
