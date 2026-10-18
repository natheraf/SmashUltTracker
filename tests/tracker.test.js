import { beforeEach, describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from './helpers.js';

let ctx;
let streamer;
let db;
let chars;

beforeEach(async (t) => {
  ctx = await setupTestServer(t);
  db = ctx.db;
  streamer = await approvedStreamer(ctx);
  chars = (await ctx.client.get('/api/characters')).body.characters;
});

const mario = () => chars.find((c) => c.slug === 'mario').id;
const donkeyKong = () => chars.find((c) => c.slug === 'donkey-kong').id;

describe('public characters endpoint', () => {
  it('returns the full roster in select order', () => {
    expect(chars).toHaveLength(86);
    expect(chars[0].slug).toBe('mario');
    expect(chars.at(-1).slug).toBe('mii-gunner');
  });
});

describe('tracker access control', () => {
  it('requires login and the streamer permission', async () => {
    const anon = makeClient(ctx.base);
    expect((await anon.post('/api/tracker/heartbeat', {})).status).toBe(401);

    await ctx.client.post('/api/auth/register', {
      username: 'pendingguy',
      password: 'password123',
      display_name: 'Pending',
      twitch_url: 'https://twitch.tv/pendingguy',
    });
    const pending = makeClient(ctx.base);
    await pending.post('/api/auth/login', { username: 'pendingguy', password: 'password123' });
    expect((await pending.post('/api/tracker/heartbeat', {})).status).toBe(403);
  });
});

describe('heartbeat and selection', () => {
  it('records heartbeats and reports state', async () => {
    const res = await streamer.post('/api/tracker/heartbeat', {});
    expect(res.status).toBe(200);
    expect(res.body.state.mode).toBe('streak');
    expect(res.body.state.in_progress).toBe(false);
    const ts = db.prepare('SELECT * FROM tracker_sessions WHERE streamer_id IS NOT NULL').get();
    expect(ts.last_heartbeat).toBeTruthy();
  });

  it('selecting a character does not create a streak row by itself', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    const state = (await streamer.get('/api/tracker/state')).body;
    expect(state.selected_character_id).toBe(mario());
    expect(state.streaks).toHaveLength(0);
    expect(state.in_progress).toBe(false);
  });

  it('rejects unknown characters', async () => {
    const res = await streamer.post('/api/tracker/streak/select', { character_id: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_character');
  });
});

describe('streak wins', () => {
  it('+1 creates the row, runs the timer and marks the streamer in progress', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    const win = await streamer.post('/api/tracker/streak/win', {});
    expect(win.status).toBe(200);
    expect(win.body.wins).toBe(1);
    expect(win.body.state.streaks).toHaveLength(1);
    expect(win.body.state.active_streak.running).toBe(true);
    expect(win.body.state.active_streak.paused).toBe(false);
    expect(win.body.state.in_progress).toBe(true);
  });

  it('fires milestone timeline events at 10, 25 and 40 — once each', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 9, seconds: 0 });
    for (let i = 0; i < 16; i++) await streamer.post('/api/tracker/streak/win', {});
    let milestones = db
      .prepare("SELECT * FROM timeline_events WHERE type = 'milestone' ORDER BY id")
      .all();
    expect(milestones.map((m) => JSON.parse(m.payload).wins)).toEqual([10, 25]);

    // Corrections via /set never re-fire earned milestones.
    await streamer.post('/api/tracker/streak/set', { wins: 8 });
    await streamer.post('/api/tracker/streak/set', { wins: 30 });
    milestones = db.prepare("SELECT * FROM timeline_events WHERE type = 'milestone'").all();
    expect(milestones).toHaveLength(2);
  });
});

describe('streak loss', () => {
  it('records the attempt, resets wins and keeps in-progress briefly', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 12, seconds: 60 });
    const loss = await streamer.post('/api/tracker/streak/loss', {});
    expect(loss.status).toBe(200);

    const streak = loss.body.state.active_streak;
    expect(streak.wins).toBe(0);
    expect(streak.elapsed_seconds).toBeLessThan(5); // timer restarted with the new attempt
    expect(streak.milestones_reached).toBe(0);

    const attempt = db
      .prepare("SELECT * FROM attempts WHERE result = 'failed'")
      .get();
    expect(attempt.wins).toBe(12);
    expect(attempt.duration_seconds).toBeGreaterThanOrEqual(60);

    const sf = db.prepare("SELECT * FROM timeline_events WHERE type = 'streak_failed'").get();
    expect(JSON.parse(sf.payload).wins).toBe(12);
    expect(loss.body.state.in_progress).toBe(true); // zero_since grace window
  });

  it('below 10 wins no streak_failed event is added', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 4, seconds: 0 });
    await streamer.post('/api/tracker/streak/loss', {});
    expect(db.prepare("SELECT COUNT(*) AS n FROM timeline_events WHERE type = 'streak_failed'").get().n).toBe(0);
    // A best-of-4 attempt is still worth recording.
    const attempt = db.prepare('SELECT * FROM attempts').get();
    expect(attempt.wins).toBe(4);
    expect(attempt.result).toBe('failed');
  });
});

describe('timer mechanics', () => {
  it('pause freezes the timer; wins while paused do not restart it', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 2, seconds: 100 });
    const paused = await streamer.post('/api/tracker/streak/pause', {});
    expect(paused.body.state.active_streak.running).toBe(false);
    expect(paused.body.state.active_streak.paused).toBe(true);
    expect(paused.body.state.active_streak.elapsed_seconds).toBeGreaterThanOrEqual(100);
    expect(paused.body.state.active_streak.elapsed_seconds).toBeLessThan(105);

    const win = await streamer.post('/api/tracker/streak/win', {});
    expect(win.body.wins).toBe(3);
    expect(win.body.state.active_streak.running).toBe(false);

    const resumed = await streamer.post('/api/tracker/streak/resume', {});
    expect(resumed.body.state.active_streak.running).toBe(true);
    expect(resumed.body.state.active_streak.elapsed_seconds).toBeGreaterThanOrEqual(100);
    expect(resumed.body.state.active_streak.elapsed_seconds).toBeLessThan(105);
  });

  it('switching characters freezes the first timer without resetting the streak', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 3, seconds: 100 });
    await streamer.post('/api/tracker/streak/select', { character_id: donkeyKong() });

    const state = (await streamer.get('/api/tracker/state')).body;
    const marioRow = state.streaks.find((s) => s.character_id === mario());
    expect(marioRow.wins).toBe(3);
    expect(marioRow.running).toBe(false);
    expect(marioRow.elapsed_seconds).toBeGreaterThanOrEqual(100);
    expect(marioRow.elapsed_seconds).toBeLessThan(105);
    expect(state.selected_character_id).toBe(donkeyKong());
  });

  it('the finalize job freezes a dead tracker at its last heartbeat, and a return resumes', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/win', {});

    const lastBeat = new Date(Date.now() - 180_000).toISOString();
    const startedAt = new Date(Date.now() - 240_000).toISOString();
    db.prepare('UPDATE tracker_sessions SET last_heartbeat = ?').run(lastBeat);
    db.prepare('UPDATE streak_progress SET running_since = ?').run(startedAt);

    const { finalizeStaleTimers } = await import('../server/jobs/finalizeTimers.js');
    const frozen = finalizeStaleTimers(db, Date.now());
    expect(frozen).toBe(1);

    let row = db.prepare('SELECT * FROM streak_progress').get();
    expect(row.running_since).toBeNull();
    expect(row.accumulated_seconds).toBe(60); // last_heartbeat - running_since

    // Tracker returns: the timer picks up where it left off, gap excluded.
    await streamer.post('/api/tracker/heartbeat', {});
    row = db.prepare('SELECT * FROM streak_progress').get();
    expect(row.running_since).toBeTruthy();
    expect(row.accumulated_seconds).toBe(60);
  });
});

describe('in-progress detection', () => {
  it('goes false when heartbeats stop or the zero window expires', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/win', {});

    // Stale heartbeat.
    db.prepare('UPDATE tracker_sessions SET last_heartbeat = ?').run(
      new Date(Date.now() - 6 * 60_000).toISOString(),
    );
    const stale = db.prepare('SELECT last_heartbeat FROM tracker_sessions').get();
    expect(Date.now() - Date.parse(stale.last_heartbeat)).toBeGreaterThan(5 * 60_000);

    // Fresh heartbeat but at zero wins past the grace window.
    await streamer.post('/api/tracker/heartbeat', {});
    await streamer.post('/api/tracker/streak/loss', {});
    db.prepare('UPDATE streak_progress SET zero_since = ?, wins = 0').run(
      new Date(Date.now() - 6 * 60_000).toISOString(),
    );
    const res = await streamer.get('/api/tracker/state');
    expect(res.body.in_progress).toBe(false);
  });
});

describe('completions', () => {
  it('creates a keep-first completion at 50 wins and clears the row', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/start', { wins: 49, seconds: 120 });
    const win = await streamer.post('/api/tracker/streak/win', {});
    expect(win.body.completion.completed).toBe(true);
    expect(win.body.completion.attemptsCount).toBe(1);

    const completion = db.prepare('SELECT * FROM completions').get();
    expect(completion.character_id).toBe(mario());
    expect(completion.duration_seconds).toBeGreaterThanOrEqual(120);
    expect(completion.attempts_count).toBe(1);

    const attempt = db.prepare("SELECT * FROM attempts WHERE result = 'completed'").get();
    expect(attempt.wins).toBe(50);

    expect(db.prepare('SELECT COUNT(*) AS n FROM streak_progress').get().n).toBe(0);
    const state = (await streamer.get('/api/tracker/state')).body;
    expect(state.selected_character_id).toBeNull();
    expect(
      db.prepare("SELECT * FROM timeline_events WHERE type = 'completion'").get(),
    ).toBeTruthy();
  });

  it('keeps an existing completion when a backfill already recorded it', async () => {
    const charId = donkeyKong();
    const userId = db.prepare('SELECT id FROM users WHERE username = ?').get('nairomk').id;
    db.prepare(
      `INSERT INTO completions (streamer_id, character_id, completed_at, duration_seconds, attempts_count)
       VALUES (?, ?, ?, 999, 3)`,
    ).run(userId, charId, new Date(Date.now() - 86400_000).toISOString());

    await streamer.post('/api/tracker/streak/select', { character_id: charId });
    await streamer.post('/api/tracker/streak/start', { wins: 49, seconds: 50 });
    const win = await streamer.post('/api/tracker/streak/win', {});
    expect(win.body.completion.completed).toBe(false);

    const completions = db.prepare('SELECT * FROM completions WHERE character_id = ?').all(charId);
    expect(completions).toHaveLength(1);
    expect(completions[0].duration_seconds).toBe(999); // untouched
    expect(db.prepare('SELECT COUNT(*) AS n FROM streak_progress').get().n).toBe(0);
  });
});

describe('mode switching', () => {
  it('streak endpoints refuse in ironman mode', async () => {
    await streamer.post('/api/tracker/streak/select', { character_id: mario() });
    await streamer.post('/api/tracker/streak/win', {});
    const mode = await streamer.post('/api/tracker/mode', { mode: 'ironman' });
    expect(mode.status).toBe(200);
    expect(mode.body.state.mode).toBe('ironman');
    // The frozen streak survives the switch.
    expect(mode.body.state.streaks[0].wins).toBe(1);
    expect(mode.body.state.streaks[0].running).toBe(false);

    const win = await streamer.post('/api/tracker/streak/win', {});
    expect(win.status).toBe(400);
    expect(win.body.error).toBe('wrong_mode');
  });
});
