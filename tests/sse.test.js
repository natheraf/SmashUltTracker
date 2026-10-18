import { beforeEach, describe, expect, it } from 'vitest';
import { approvedStreamer, setupTestServer } from './helpers.js';

let ctx;
let streamer;

beforeEach(async (t) => {
  ctx = await setupTestServer(t);
  streamer = await approvedStreamer(ctx);
});

/** Reads SSE data lines until one parses as JSON (or the deadline passes). */
async function readEvent(reader, timeoutMs = 5000) {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
    }
  }
  throw new Error('no SSE event arrived in time');
}

describe('SSE stream', () => {
  it('is public, sends a preamble and pokes clients on tracker actions', async () => {
    const controller = new AbortController();
    try {
      const res = await fetch(`${ctx.base}/api/stream`, { signal: controller.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body.getReader();

      // Preamble comment flushes the connection; by now the bus listener is attached.
      const preamble = await reader.read();
      expect(new TextDecoder().decode(preamble.value)).toContain(': connected');

      const chars = (await ctx.client.get('/api/characters')).body.characters;
      await streamer.post('/api/tracker/streak/select', { character_id: chars[0].id });
      const selectEvent = await readEvent(reader);
      expect(selectEvent.type).toBe('tracker');
      expect(selectEvent.streamerId).toBeGreaterThan(0);

      await streamer.post('/api/tracker/streak/win', {});
      const winEvent = await readEvent(reader);
      expect(winEvent.type).toBe('tracker');

      // Timeline events ride the same bus.
      await streamer.post('/api/tracker/streak/start', { wins: 9, seconds: 0 });
      await streamer.post('/api/tracker/streak/win', {});
      const types = [];
      while (types.length < 2) types.push((await readEvent(reader)).type);
      expect(types).toContain('timeline');
    } finally {
      controller.abort();
    }
  });
});
