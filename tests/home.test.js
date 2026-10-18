import { beforeEach, describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from './helpers.js';

let ctx;
let db;
let streamer;
let anon;

beforeEach(async (t) => {
  ctx = await setupTestServer(t);
  db = ctx.db;
  streamer = await approvedStreamer(ctx);
  anon = makeClient(ctx.base);
});

const streamerId = () => db.prepare("SELECT id FROM users WHERE username = 'nairomk'").get().id;
const charId = (slug) => db.prepare('SELECT id FROM characters WHERE slug = ?').get(slug).id;

/** Goes through the real routes so the rows look exactly like production. */
async function completeSamus() {
  const samus = charId('samus');
  await streamer.post('/api/tracker/streak/select', { character_id: samus });
  await streamer.post('/api/tracker/streak/win', {});
  await streamer.post('/api/tracker/streak/loss', {});
  await streamer.post('/api/tracker/streak/set', { wins: 50 });
  return samus;
}

describe('home snapshot', () => {
  it('is public and defaults to the first approved streamer', async () => {
    const res = await anon.get('/api/home');
    expect(res.status).toBe(200);
    expect(res.body.primary_streamer_id).toBe(streamerId());
    expect(res.body.streamers.map((s) => s.username)).toEqual(['nairomk']);
    expect(res.body.streaks).toEqual([]);
    expect(res.body.ironman).toEqual([]);
  });

  it('lists a streamer who is mid-streak and drops a stale heartbeat', async () => {
    const samus = charId('samus');
    await streamer.post('/api/tracker/streak/select', { character_id: samus });
    await streamer.post('/api/tracker/streak/win', {});
    await streamer.post('/api/tracker/streak/win', {});

    const first = (await anon.get('/api/home')).body;
    expect(first.streaks).toHaveLength(1);
    expect(first.streaks[0]).toMatchObject({
      streamer_id: streamerId(),
      display_name: 'Nai',
      wins: 2,
      target: 50,
      running: true,
      paused: false,
    });
    expect(first.streaks[0].character).toMatchObject({ id: samus, slug: 'samus' });
    expect(first.streaks[0].elapsed_seconds).toBeGreaterThanOrEqual(0);

    db.prepare(
      "UPDATE tracker_sessions SET last_heartbeat = strftime('%Y-%m-%dT%H:%M:%fZ','now','-6 minutes')",
    ).run();
    expect((await anon.get('/api/home')).body.streaks).toEqual([]);
  });

  it('keeps a zero-win run live only inside the five-minute window', async () => {
    const kirby = charId('kirby');
    await streamer.post('/api/tracker/streak/select', { character_id: kirby });
    await streamer.post('/api/tracker/streak/win', {});
    // A loss drops back to zero wins and starts the five-minute window.
    await streamer.post('/api/tracker/streak/loss', {});
    expect((await anon.get('/api/home')).body.streaks).toHaveLength(1);

    // Fresh heartbeat, but the run has been sitting at zero wins for a while.
    db.prepare(
      "UPDATE streak_progress SET zero_since = strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')",
    ).run();
    expect((await anon.get('/api/home')).body.streaks).toEqual([]);
  });

  it('lists an in-progress Ironman run with its current draw', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const draw = await streamer.post('/api/tracker/ironman/draw', {});

    const home = (await anon.get('/api/home')).body;
    expect(home.ironman).toHaveLength(1);
    const [card] = home.ironman;
    expect(card).toMatchObject({ streamer_id: streamerId(), won: 0, total: 86, running: true });
    expect(card.drawn.slug).toBe(draw.body.character.slug);
    expect(home.streaks).toEqual([]);
  });
});

describe('streamer progress', () => {
  it('returns streaks, completions and the live selection', async () => {
    const samus = await completeSamus();
    const kirby = charId('kirby');
    await streamer.post('/api/tracker/streak/select', { character_id: kirby });
    await streamer.post('/api/tracker/streak/win', {});

    const res = await anon.get(`/api/streamers/${streamerId()}`);
    expect(res.status).toBe(200);
    expect(res.body.streamer.display_name).toBe('Nai');
    expect(res.body.live).toBe(true);
    expect(res.body.selected_character_id).toBe(kirby);
    expect(res.body.streaks).toEqual([
      expect.objectContaining({ character_id: kirby, wins: 1, running: true }),
    ]);
    expect(res.body.completions).toEqual([
      expect.objectContaining({ character_id: samus, attempts_count: 2 }),
    ]);
    expect(res.body.ironman).toBeNull();
  });

  it('reports the won fighters of an active Ironman run', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const draw = await streamer.post('/api/tracker/ironman/draw', {});
    await streamer.post('/api/tracker/ironman/win', {});
    await streamer.post('/api/tracker/ironman/draw', {});

    const res = await anon.get(`/api/streamers/${streamerId()}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('ironman');
    expect(res.body.ironman.won_count).toBe(1);
    expect(res.body.ironman.total).toBe(86);
    expect(res.body.ironman.won_ids).toEqual([charId(draw.body.character.slug)]);
    expect(res.body.ironman.current_draw.slug).toBeTruthy();
  });

  it('hides users who are not approved streamers', async () => {
    await anon.post('/api/auth/register', {
      username: 'pending1',
      password: 'password123',
      display_name: 'Pending',
      twitch_url: 'https://twitch.tv/pending1',
    });
    const pendingId = db.prepare("SELECT id FROM users WHERE username = 'pending1'").get().id;

    expect((await anon.get(`/api/streamers/${pendingId}`)).status).toBe(404);
    expect((await anon.get('/api/streamers/9999')).status).toBe(404);
    expect((await anon.get('/api/streamers/not-a-number')).status).toBe(400);
  });
});

describe('character detail', () => {
  it('summarises attempts, the completion and approved VODs only', async () => {
    const samus = await completeSamus();

    db.prepare(
      `INSERT INTO vod_submissions
         (streamer_id, character_id, youtube_url, video_id, title, thumbnail,
          start_timestamp, completion_date, ip_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      streamerId(),
      samus,
      'https://www.youtube.com/watch?v=abc12345678',
      'abc12345678',
      'Samus vs Ganon',
      'https://i.ytimg.com/vi/abc12345678/hqdefault.jpg',
      615,
      null,
      'hash-1',
      'approved',
      '2026-01-02T03:04:05.000Z',
    );
    db.prepare(
      `INSERT INTO vod_submissions
         (streamer_id, character_id, youtube_url, video_id, ip_hash, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
    ).run(streamerId(), samus, 'https://www.youtube.com/watch?v=pending0001', 'pending0001', 'hash-2');

    const res = await anon.get(`/api/streamers/${streamerId()}/characters/${samus}`);
    expect(res.status).toBe(200);
    expect(res.body.character.slug).toBe('samus');
    expect(res.body.completion.attempts_count).toBe(2);
    expect(res.body.completion.completed_at).toBeTruthy();
    expect(res.body.attempts).toMatchObject({ count: 2, failed: 1, completed: 1, best_wins: 50 });
    expect(res.body.vods).toHaveLength(1);
    expect(res.body.vods[0]).toMatchObject({ video_id: 'abc12345678', start_timestamp: 615 });
    expect(res.body.streak).toBeNull();

    expect((await anon.get(`/api/streamers/${streamerId()}/characters/9999`)).status).toBe(404);
  });

  it('reports a partial streak while it is running', async () => {
    const kirby = charId('kirby');
    await streamer.post('/api/tracker/streak/select', { character_id: kirby });
    await streamer.post('/api/tracker/streak/win', {});
    await streamer.post('/api/tracker/streak/win', {});
    await streamer.post('/api/tracker/streak/win', {});

    const res = await anon.get(`/api/streamers/${streamerId()}/characters/${kirby}`);
    expect(res.status).toBe(200);
    expect(res.body.streak.wins).toBe(3);
    expect(res.body.streak.running).toBe(true);
    expect(res.body.completion).toBeNull();
    expect(res.body.vods).toEqual([]);
  });
});

describe('timeline', () => {
  it('returns newest first with a working before cursor', async () => {
    await completeSamus();
    // A second run that fails at 12 wins adds a milestone and a streak_failed
    // event, so pagination has something to page through.
    const kirby = charId('kirby');
    await streamer.post('/api/tracker/streak/select', { character_id: kirby });
    for (let i = 0; i < 12; i += 1) await streamer.post('/api/tracker/streak/win', {});
    await streamer.post('/api/tracker/streak/loss', {});

    const all = await anon.get('/api/timeline');
    expect(all.status).toBe(200);
    const types = all.body.events.map((event) => event.type);
    expect(types).toContain('completion');
    expect(types).toContain('streak_failed');
    expect(types).toContain('streamer_joined');
    expect(all.body.next_before).toBeNull();

    const completion = all.body.events.find((event) => event.type === 'completion');
    expect(completion.streamer.display_name).toBe('Nai');
    expect(completion.character.slug).toBe('samus');
    expect(completion.payload).toMatchObject({ attempts: 2 });

    const failure = all.body.events.find((event) => event.type === 'streak_failed');
    expect(failure.character.slug).toBe('kirby');
    expect(failure.payload).toMatchObject({ wins: 12 });

    const ids = all.body.events.map((event) => event.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);

    const first = await anon.get('/api/timeline?limit=2');
    expect(first.body.events).toHaveLength(2);
    expect(first.body.next_before).toEqual(expect.any(Number));

    const cursor = first.body.next_before;
    const older = await anon.get(`/api/timeline?before=${cursor}&limit=50`);
    expect(older.status).toBe(200);
    expect(older.body.events.length).toBeGreaterThan(0);
    for (const event of older.body.events) {
      expect(event.id).toBeLessThan(cursor);
    }
    // Two pages cover the whole timeline exactly once.
    expect([...first.body.events, ...older.body.events].map((event) => event.id)).toEqual(ids);
  });

  it('validates the query', async () => {
    expect((await anon.get('/api/timeline?limit=0')).status).toBe(400);
    expect((await anon.get('/api/timeline?limit=99')).status).toBe(400);
    expect((await anon.get('/api/timeline?before=abc')).status).toBe(400);
  });
});
