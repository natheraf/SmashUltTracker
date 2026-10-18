import { bus } from './bus.js';

/**
 * Opens an SSE response and forwards bus pokes. `filter(event)` decides which
 * pokes a given subscriber sees. Writes a comment preamble immediately so the
 * client's connection opens without waiting for the first event.
 */
export function openSseStream(req, res, { filter = () => true } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer SSE
  });
  res.write(': connected\n\n');

  const onUpdate = (event) => {
    if (!filter(event)) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const keepalive = setInterval(() => res.write(': keepalive\n\n'), 20_000);

  bus.on('update', onUpdate);
  req.on('close', () => {
    clearInterval(keepalive);
    bus.off('update', onUpdate);
  });
}
