import { beforeEach, describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from './helpers.js';

let ctx;
let streamer;
let db;

beforeEach(async (t) => {
  ctx = await setupTestServer(t);
  db = ctx.db;
  streamer = await approvedStreamer(ctx);
});

const entries = (runId) =>
  db.prepare('SELECT e.status, c.slug FROM ironman_entries e JOIN characters c ON c.id = e.character_id WHERE e.run_id = ?').all(runId);
const runRow = () => db.prepare('SELECT * FROM ironman_runs').get();
const counts = (runId) => {
  const rows = entries(runId);
  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    drawn: rows.filter((r) => r.status === 'drawn').length,
    won: rows.filter((r) => r.status === 'won').length,
    lost: rows.filter((r) => r.status === 'lost').length,
  };
};

describe('ironman runs', () => {
  it('starts a run with the whole roster pending and the timer ticking', async () => {
    const res = await streamer.post('/api/tracker/ironman/start', {});
    expect(res.status).toBe(200);
    expect(res.body.run_id).toBeGreaterThan(0);
    expect(res.body.state.mode).toBe('ironman');

    const run = runRow();
    expect(run.status).toBe('active');
    expect(run.running_since).toBeTruthy();
    expect(counts(run.id)).toEqual({ pending: 86, drawn: 0, won: 0, lost: 0 });

    const view = res.body.state.ironman;
    expect(view.total).toBe(86);
    expect(view.won_count).toBe(0);
    expect(view.current_draw).toBeNull();
    expect(view.running).toBe(true);
  });

  it('refuses a second concurrent run', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const again = await streamer.post('/api/tracker/ironman/start', {});
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('run_active');
  });

  it('requires the streamer permission and an active run', async () => {
    const drawBeforeStart = await streamer.post('/api/tracker/ironman/draw', {});
    expect(drawBeforeStart.status).toBe(400);
    expect(drawBeforeStart.body.error).toBe('no_run');

    const anon = await makeClient(ctx.base);
    expect((await anon.post('/api/tracker/ironman/start', {})).status).toBe(401);
  });
});

describe('ironman draws', () => {
  it('draws one random character and refuses to reroll while one is drawn', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    const runId = started.body.run_id;

    const draw = await streamer.post('/api/tracker/ironman/draw', {});
    expect(draw.status).toBe(200);
    expect(draw.body.character.slug).toBeTruthy();
    expect(counts(runId)).toEqual({ pending: 85, drawn: 1, won: 0, lost: 0 });
    expect(draw.body.state.ironman.current_draw.slug).toBe(draw.body.character.slug);

    // No rerolls: the pending draw must be resolved first.
    const again = await streamer.post('/api/tracker/ironman/draw', {});
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('draw_pending');
    // The state still shows the original draw (it persists across requests).
    expect((await streamer.get('/api/tracker/state')).body.ironman.current_draw.slug).toBe(
      draw.body.character.slug,
    );
  });

  it('draws without repeats and can exhaust the pool', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    const runId = started.body.run_id;
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const draw = await streamer.post('/api/tracker/ironman/draw', {});
      const slug = draw.body.character.slug;
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
      // Bank the win so the next draw is allowed.
      await streamer.post('/api/tracker/ironman/win', {});
    }
    expect(seen.size).toBe(5);
    expect(counts(runId)).toEqual({ pending: 81, drawn: 0, won: 5, lost: 0 });
  });

  it('records the draw order', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    await streamer.post('/api/tracker/ironman/draw', {});
    await streamer.post('/api/tracker/ironman/win', {});
    await streamer.post('/api/tracker/ironman/draw', {});
    const rows = db
      .prepare('SELECT draw_order, status FROM ironman_entries WHERE run_id = ? AND draw_order IS NOT NULL ORDER BY draw_order')
      .all(started.body.run_id);
    expect(rows.map((r) => r.draw_order)).toEqual([1, 2]);
    expect(rows.map((r) => r.status)).toEqual(['won', 'drawn']);
  });
});

describe('ironman win / loss', () => {
  it('winning without a draw is rejected', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const res = await streamer.post('/api/tracker/ironman/win', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_draw');
  });

  it('a win banks the character and clears the draw', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    const draw = await streamer.post('/api/tracker/ironman/draw', {});
    const win = await streamer.post('/api/tracker/ironman/win', {});
    expect(win.status).toBe(200);
    expect(win.body.completed).toBe(false);

    const slug = draw.body.character.slug;
    const entry = db
      .prepare('SELECT * FROM ironman_entries WHERE run_id = ? AND character_id = (SELECT id FROM characters WHERE slug = ?)')
      .get(started.body.run_id, slug);
    expect(entry.status).toBe('won');
    expect(entry.won_at).toBeTruthy();
    expect(win.body.state.ironman.current_draw).toBeNull();
    expect(win.body.state.ironman.won_count).toBe(1);
  });

  it('one loss ends the run (hardcore) and freezes it', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    const draw = await streamer.post('/api/tracker/ironman/draw', {});
    const loss = await streamer.post('/api/tracker/ironman/loss', {});
    expect(loss.status).toBe(200);

    const run = runRow();
    expect(run.status).toBe('failed');
    expect(run.ended_at).toBeTruthy();
    expect(run.running_since).toBeNull();

    const entry = db
      .prepare('SELECT * FROM ironman_entries WHERE run_id = ? AND status = ?')
      .get(started.body.run_id, 'lost');
    expect(entry.character_id).toBeGreaterThan(0);

    const event = db.prepare("SELECT * FROM timeline_events WHERE type = 'ironman_failed'").get();
    expect(JSON.parse(event.payload).character).toBe(draw.body.character.name);

    // No active run any more, and the finished run shows up in history.
    const stateAfter = (await streamer.get('/api/tracker/state')).body;
    expect(stateAfter.ironman).toBeNull();
    expect(stateAfter.ironman_history).toHaveLength(1);
    expect(stateAfter.ironman_history[0].status).toBe('failed');
    expect(stateAfter.ironman_history[0].won_count).toBe(0);

    // Losing again is impossible; a fresh run must be started.
    expect((await streamer.post('/api/tracker/ironman/loss', {})).body.error).toBe('no_run');
    const restarted = await streamer.post('/api/tracker/ironman/start', {});
    expect(restarted.status).toBe(200);
  });

  it('completes the run when every character has been won', async () => {
    const started = await streamer.post('/api/tracker/ironman/start', {});
    const runId = started.body.run_id;

    // Simulate a nearly-finished run, then play the last character for real.
    db.prepare("UPDATE ironman_entries SET status = 'won', won_at = ? WHERE run_id = ? AND status = 'pending' AND id NOT IN (SELECT id FROM ironman_entries WHERE run_id = ? ORDER BY id LIMIT 1)").run(
      new Date().toISOString(),
      runId,
      runId,
    );
    expect(counts(runId)).toEqual({ pending: 1, drawn: 0, won: 85, lost: 0 });

    await streamer.post('/api/tracker/ironman/draw', {});
    const win = await streamer.post('/api/tracker/ironman/win', {});
    expect(win.body.completed).toBe(true);

    const run = runRow();
    expect(run.status).toBe('completed');
    expect(run.ended_at).toBeTruthy();
    expect(run.running_since).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM timeline_events WHERE type = 'ironman_completed'").get().n,
    ).toBe(1);
    expect((await streamer.get('/api/tracker/state')).body.ironman).toBeNull();
    expect((await streamer.get('/api/tracker/state')).body.ironman_history[0].won_count).toBe(86);
  });

  it('pauses and resumes the run timer', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const paused = await streamer.post('/api/tracker/ironman/pause', {});
    expect(paused.body.state.ironman.paused).toBe(true);
    expect(paused.body.state.ironman.running).toBe(false);
    const frozen = runRow().accumulated_seconds;

    const resumed = await streamer.post('/api/tracker/ironman/resume', {});
    expect(resumed.body.state.ironman.paused).toBe(false);
    expect(resumed.body.state.ironman.running).toBe(true);
    expect(runRow().accumulated_seconds).toBe(frozen);
  });

  it('can be abandoned without a loss', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    const res = await streamer.post('/api/tracker/ironman/abandon', {});
    expect(res.status).toBe(200);
    expect(runRow().status).toBe('failed');
    expect(res.body.state.ironman).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM timeline_events WHERE type = 'ironman_failed'").get().n).toBe(0);
  });
});

describe('ironman in-progress and overlay', () => {
  it('counts as in progress once a character is won', async () => {
    await streamer.post('/api/tracker/ironman/start', {});
    let state = (await streamer.get('/api/tracker/state')).body;
    expect(state.in_progress).toBe(true); // zero_since grace window counts here

    // Backdate the grace window: a run with no wins and an old start is idle.
    db.prepare('UPDATE ironman_runs SET zero_since = ?').run(new Date(Date.now() - 10 * 60_000).toISOString());
    state = (await streamer.get('/api/tracker/state')).body;
    expect(state.in_progress).toBe(false);

    await streamer.post('/api/tracker/ironman/draw', {});
    await streamer.post('/api/tracker/ironman/win', {});
    state = (await streamer.get('/api/tracker/state')).body;
    expect(state.in_progress).toBe(true);
  });

  it('is visible on the overlay with the current draw', async () => {
    const { overlay_token: token } = (await streamer.get('/api/tracker/state')).body;
    await streamer.post('/api/tracker/ironman/start', {});
    const draw = await streamer.post('/api/tracker/ironman/draw', {});

    const overlayRes = await ctx.client.get(`/api/overlay/${token}/state`);
    const overlay = overlayRes.body.state;
    expect(overlay.mode).toBe('ironman');
    expect(overlay.drawn.slug).toBe(draw.body.character.slug);
    expect(overlay.won).toBe(0);
    expect(overlay.total).toBe(86);
    expect(overlay.running).toBe(true);
    expect(overlay.entries).toHaveLength(86);

    await streamer.post('/api/tracker/ironman/win', {});
    const after = (await ctx.client.get(`/api/overlay/${token}/state`)).body.state;
    expect(after.won).toBe(1);
    expect(after.drawn).toBeNull();
  });
});

describe('mode switching with ironman', () => {
  it('switching to ironman freezes the streak and back again resumes it', async () => {
    const chars = (await ctx.client.get('/api/characters')).body.characters;
    const mario = chars.find((c) => c.slug === 'mario').id;
    await streamer.post('/api/tracker/streak/select', { character_id: mario });
    await streamer.post('/api/tracker/streak/win', {});

    const ironman = await streamer.post('/api/tracker/mode', { mode: 'ironman' });
    expect(ironman.body.state.streaks[0].running).toBe(false);
    expect(ironman.body.state.streaks[0].wins).toBe(1);

    await streamer.post('/api/tracker/ironman/start', {});
    expect((await streamer.get('/api/tracker/state')).body.mode).toBe('ironman');

    const back = await streamer.post('/api/tracker/mode', { mode: 'streak' });
    expect(back.body.state.streaks[0].running).toBe(true);
    expect(back.body.state.ironman.running).toBe(false);
  });
});
