import { describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from '../tests/helpers.js';
import { recordDailyWinners } from '../server/services/votes.js';
import { utcDay } from '../server/services/youtube.js';

async function setup(t) {
  const ctx = await setupTestServer(t);
  const streamer = await approvedStreamer(ctx);
  const streamerId = ctx.db.prepare("SELECT id FROM users WHERE username = 'nairomk'").get().id;
  const charId = (slug) => ctx.db.prepare('SELECT id FROM characters WHERE slug = ?').get(slug).id;
  const admin = makeClient(ctx.base);
  await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
  return { ...ctx, streamer, streamerId, charId, admin, anon: makeClient(ctx.base) };
}

/** Inserts a vote row for another visitor (all test requests share one IP hash). */
function seedVote(db, { characterId, ipHash, utcDay: day }) {
  db.prepare(
    'INSERT INTO votes (ip_hash, character_id, utc_day, created_at) VALUES (?, ?, ?, ?)',
  ).run(ipHash, characterId, day, `${day}T12:00:00.000Z`);
}

describe('community votes', () => {
  it('starts empty and lists every fighter as a candidate', async () => {
    const ctx = await setup(it);
    const res = await ctx.anon.get('/api/votes');

    expect(res.status).toBe(200);
    expect(res.body.streamer_id).toBe(ctx.streamerId);
    expect(res.body.candidates).toHaveLength(86);
    const bySelectOrder = ctx.db
      .prepare('SELECT id FROM characters ORDER BY select_order ASC')
      .all()
      .map((row) => row.id);
    expect(res.body.candidates.map((row) => row.character.id)).toEqual(bySelectOrder);
    expect(res.body.my_vote).toBeNull();
    expect(res.body.today).toEqual({ top: [], total: 0 });
    expect(res.body.winner).toBeNull();
  });

  it('counts one vote per visitor per day', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');

    const voted = await ctx.anon.post('/api/votes', { character_id: samus });
    expect(voted.status).toBe(201);
    expect(voted.body.my_vote).toBe(samus);
    expect(voted.body.today.total).toBe(1);
    expect(voted.body.today.top[0]).toMatchObject({
      today_votes: 1,
      character: { id: samus, slug: 'samus' },
    });

    const again = await ctx.anon.post('/api/votes', { character_id: ctx.charId('kirby') });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_voted');

    // Another visitor (different IP hash) can still vote today.
    seedVote(ctx.db, { characterId: ctx.charId('kirby'), ipHash: 'other-visitor', utcDay: utcDay() });
    const standings = await ctx.anon.get('/api/votes');
    expect(standings.body.today.total).toBe(2);
    expect(standings.body.today.top.map((row) => row.character.slug)).toEqual(['samus', 'kirby']);
    expect(standings.body.today.top[0].today_votes).toBe(1);
  });

  it('ranks the day’s leaders by votes, not roster order', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus'); // earlier in the select order
    const kirby = ctx.charId('kirby'); // later in the select order

    seedVote(ctx.db, { characterId: samus, ipHash: 'a', utcDay: utcDay() });
    seedVote(ctx.db, { characterId: kirby, ipHash: 'b', utcDay: utcDay() });
    seedVote(ctx.db, { characterId: kirby, ipHash: 'c', utcDay: utcDay() });

    const res = await ctx.anon.get('/api/votes');
    expect(res.body.today.top.map((row) => row.character.slug)).toEqual(['kirby', 'samus']);
    expect(res.body.today.top[0].today_votes).toBe(2);
  });

  it('validates the character', async () => {
    const ctx = await setup(it);
    expect((await ctx.anon.post('/api/votes', { character_id: 9999 })).status).toBe(400);
    expect((await ctx.anon.post('/api/votes', {})).status).toBe(400);
  });

  it('keeps fighters the primary streamer already completed out of the ballot', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');
    await ctx.streamer.post('/api/tracker/streak/select', { character_id: samus });
    await ctx.streamer.post('/api/tracker/streak/set', { wins: 50 });

    await ctx.admin.post('/api/admin/settings/primary-streamer', { user_id: ctx.streamerId });
    // /streak/set works without a prior +1: it creates the row and, at 50 wins,
    // records the completion that removes samus from the ballot.
    const hasComp = ctx.db
      .prepare('SELECT 1 FROM completions WHERE streamer_id = ? AND character_id = ?')
      .get(ctx.streamerId, samus);
    expect(hasComp).toBeTruthy();

    const res = await ctx.anon.get('/api/votes');
    const hasSamus = res.body.candidates.some((row) => row.character.id === samus);
    expect(hasSamus).toBe(false);
    expect(res.body.candidates).toHaveLength(85);
  });
});

describe('daily vote winners', () => {
  it('snapshots a finished day once and announces it', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');
    const kirby = ctx.charId('kirby');
    const yesterday = utcDay(Date.now() - 86_400_000);

    seedVote(ctx.db, { characterId: samus, ipHash: 'a', utcDay: yesterday });
    seedVote(ctx.db, { characterId: samus, ipHash: 'b', utcDay: yesterday });
    seedVote(ctx.db, { characterId: kirby, ipHash: 'c', utcDay: yesterday });

    expect(recordDailyWinners(ctx.db)).toBe(1);
    // Idempotent: a second run records nothing.
    expect(recordDailyWinners(ctx.db)).toBe(0);

    const winner = ctx.db.prepare('SELECT * FROM vote_daily_winners').all();
    expect(winner).toEqual([
      expect.objectContaining({ utc_day: yesterday, character_id: samus, votes: 2 }),
    ]);

    const events = ctx.db
      .prepare("SELECT * FROM timeline_events WHERE type = 'vote_winner'")
      .all();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toEqual({ utc_day: yesterday, votes: 2 });

    const res = await ctx.anon.get('/api/votes');
    expect(res.body.winner).toMatchObject({
      utc_day: yesterday,
      votes: 2,
      character: { id: samus, slug: 'samus' },
    });

    const timeline = await ctx.anon.get('/api/timeline');
    const event = timeline.body.events.find((e) => e.type === 'vote_winner');
    expect(event.character.slug).toBe('samus');
    expect(event.payload).toMatchObject({ utc_day: yesterday, votes: 2 });
  });

  it('never snapshots the current day', async () => {
    const ctx = await setup(it);
    seedVote(ctx.db, { characterId: ctx.charId('samus'), ipHash: 'a', utcDay: utcDay() });
    expect(recordDailyWinners(ctx.db)).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM vote_daily_winners').get().n).toBe(0);
  });
});
