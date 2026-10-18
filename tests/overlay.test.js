import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { approvedStreamer, setupTestServer } from './helpers.js';

let ctx;
let streamer;
let chars;

beforeEach(async (t) => {
  ctx = await setupTestServer(t);
  streamer = await approvedStreamer(ctx);
  chars = (await ctx.client.get('/api/characters')).body.characters;
});

const mario = () => chars.find((c) => c.slug === 'mario').id;
const donkeyKong = () => chars.find((c) => c.slug === 'donkey-kong').id;
const tokenInDb = () => ctx.db.prepare('SELECT overlay_token FROM tracker_sessions').get()?.overlay_token;

describe('overlay token', () => {
  it('is minted on first state read and stays stable', async () => {
    const first = (await streamer.get('/api/tracker/state')).body;
    expect(first.overlay_token).toBeTruthy();
    expect(first.overlay_token).toBe(tokenInDb());
    expect(first.overlay_token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const second = (await streamer.get('/api/tracker/state')).body;
    expect(second.overlay_token).toBe(first.overlay_token);
  });

  it('regenerating immediately invalidates the old link', async () => {
    const oldToken = (await streamer.get('/api/tracker/state')).body.overlay_token;
    expect((await ctx.client.get(`/api/overlay/${oldToken}/state`)).status).toBe(200);

    const regen = await streamer.post('/api/tracker/overlay/regenerate', {});
    expect(regen.status).toBe(200);
    expect(regen.body.overlay_token).not.toBe(oldToken);
    expect(tokenInDb()).toBe(regen.body.overlay_token);

    expect((await ctx.client.get(`/api/overlay/${oldToken}/state`)).status).toBe(404);
    expect((await ctx.client.get(`/api/overlay/${regen.body.overlay_token}/state`)).status).toBe(200);
  });
});

describe('overlay state', () => {
  it('is public, needs no login and hides the token itself', async () => {
    const { overlay_token: token } = (await streamer.get('/api/tracker/state')).body;
    const res = await ctx.client.get(`/api/overlay/${token}/state`);
    expect(res.status).toBe(200);
    const overlay = res.body.state;
    expect(overlay.mode).toBe('streak');
    expect(overlay.character).toBeNull();
    expect(overlay.wins).toBe(0);
    expect(overlay.target).toBe(50);
    expect(overlay.running).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(overlay.streamer.display_name).toBe('Nai');
  });

  it('reflects the live streak', async () => {
    const { overlay_token: token } = (await streamer.get('/api/tracker/state')).body;
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/win', {});

    const res = await ctx.client.get(`/api/overlay/${token}/state`);
    const overlay = res.body.state;
    expect(overlay.character.slug).toBe('mario');
    expect(overlay.wins).toBe(1);
    expect(overlay.running).toBe(true);
    expect(overlay.in_progress).toBe(true);
    expect(overlay.attempt).toBe(1);
  });

  it('404s on unknown tokens', async () => {
    expect((await ctx.client.get('/api/overlay/definitely-not-real/state')).status).toBe(404);
    expect((await ctx.client.get('/api/overlay/definitely-not-real/stream')).status).toBe(404);
  });
});

describe('overlay stream', () => {
  it('forwards this streamer and filters other streamers out', async () => {
    const { overlay_token: token } = (await streamer.get('/api/tracker/state')).body;
    const other = await approvedStreamer(ctx, 'otherguy');

    const controller = new AbortController();
    try {
      const res = await fetch(`${ctx.base}/api/overlay/${token}/stream`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // One reader for the whole test: SSE data is a single ordered stream, so
      // concurrent readers would steal each other's events.
      const events = [];
      const reader = res.body.getReader();
      const pump = (async () => {
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
            }
          }
        } catch {
          /* aborted at the end of the test */
        }
      })();

      // Another streamer's activity must not leak into this overlay.
      await other.post('/api/tracker/streak/select', { character_id: donkeyKong() });
      await other.post('/api/tracker/streak/win', {});
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(events).toHaveLength(0);

      await streamer.post('/api/tracker/streak/select', { character_id: mario() });
      const deadline = Date.now() + 5000;
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('tracker');
      expect(events[0].streamerId).toBeGreaterThan(0);
    } finally {
      controller.abort();
    }
  });
});

describe('character images', () => {
  it('404s with a helpful code before the images are fetched', async () => {
    const res = await ctx.client.get('/api/images/mario.png');
    expect(res.status).toBe(404);
  });

  it('serves a downloaded image', async () => {
    const dir = path.join(ctx.config.dataDir, 'images');
    fs.mkdirSync(dir, { recursive: true });
    // Bytes don't matter for the route; the filename maps to the roster slug.
    fs.writeFileSync(path.join(dir, 'mario.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const res = await fetch(`${ctx.base}/api/images/mario.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect((await res.arrayBuffer()).byteLength).toBe(8);
  });

  it('rejects unknown slugs and path traversal attempts', async () => {
    expect((await ctx.client.get('/api/images/not-a-fighter.png')).status).toBe(404);
    expect((await ctx.client.get('/api/images/..%2F..%2Fserver%2Fdb.js')).status).toBe(404);
    expect((await ctx.client.get('/api/images/mario.txt')).status).toBe(404);
  });
});

describe('client config', () => {
  it('reports the captcha feature as off by default', async () => {
    const res = await ctx.client.get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.turnstile_site_key).toBeNull();
  });
});
