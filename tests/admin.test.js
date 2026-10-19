import { describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from '../tests/helpers.js';
import { utcDay } from '../server/services/youtube.js';

/**
 * The admin API is the only place that can change another account's data, so
 * these tests lean on permission checks as much as on the happy paths. Every
 * endpoint is gated twice: `requireUser` in the router and a permission on the
 * individual route.
 */

async function setup(t) {
  const ctx = await setupTestServer(t);
  const streamer = await approvedStreamer(ctx);
  const streamerId = ctx.db.prepare("SELECT id FROM users WHERE username = 'nairomk'").get().id;
  const adminId = ctx.db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  const charId = (slug) => ctx.db.prepare('SELECT id FROM characters WHERE slug = ?').get(slug).id;
  const admin = makeClient(ctx.base);
  await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
  const anon = makeClient(ctx.base);
  return { ...ctx, streamer, streamerId, adminId, charId, admin, anon };
}

/** Registers + approves a second streamer, returning their id. */
async function addStreamer(ctx, username) {
  await ctx.anon.post('/api/auth/register', {
    username,
    password: 'password123',
    display_name: username.toUpperCase(),
    twitch_url: `https://twitch.tv/${username}`,
  });
  const id = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  await ctx.admin.post(`/api/admin/streamers/${id}/approve`, {});
  return id;
}

const submit = (ctx, overrides) =>
  ctx.anon.post('/api/submissions', {
    streamer_id: ctx.streamerId,
    character_id: ctx.charId('samus'),
    youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
    ...overrides,
  });

describe('admin API', () => {
  it('gates the panel behind a permission', async () => {
    const ctx = await setup(it);

    expect((await ctx.anon.get('/api/admin/overview')).status).toBe(401);
    expect((await ctx.streamer.get('/api/admin/overview')).status).toBe(403);
    expect((await ctx.streamer.get('/api/admin/users')).status).toBe(403);
    expect((await ctx.streamer.get('/api/admin/submissions')).status).toBe(403);
    expect((await ctx.streamer.get('/api/admin/audit')).status).toBe(403);
    expect((await ctx.admin.get('/api/admin/overview')).status).toBe(200);
  });

  it('summarises the queues for the landing page', async () => {
    const ctx = await setup(it);
    await submit(ctx, {});
    await submit(ctx, {
      character_id: ctx.charId('mario'),
      youtube_url: 'https://youtu.be/aaaaaaaaaaa',
    });

    const res = await ctx.admin.get('/api/admin/overview');
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      pending_submissions: 2,
      approved_submissions: 0,
      pending_streamers: 0,
      completions: 0,
    });
    expect(res.body.counts.users).toBeGreaterThanOrEqual(2);
    expect(res.body.primary_streamer_id).toBe(ctx.streamerId);
    expect(res.body.roles.map((role) => role.name)).toEqual(['admin', 'streamer']);
  });

  it('filters the review queue and reviews in bulk', async () => {
    const ctx = await setup(it);
    const secondId = await addStreamer(ctx, 'rival');
    const mario = ctx.charId('mario');

    await submit(ctx, {});
    await submit(ctx, { youtube_url: 'https://youtu.be/aaaaaaaaaaa' });
    await submit(ctx, {
      streamer_id: secondId,
      character_id: mario,
      youtube_url: 'https://youtu.be/bbbbbbbbbbb',
    });

    const all = await ctx.admin.get('/api/admin/submissions?status=pending');
    expect(all.body.total).toBe(3);

    const byStreamer = await ctx.admin.get(`/api/admin/submissions?streamer_id=${ctx.streamerId}`);
    expect(byStreamer.body.total).toBe(2);
    const byCharacter = await ctx.admin.get(`/api/admin/submissions?character_id=${mario}`);
    expect(byCharacter.body.total).toBe(1);
    expect(byCharacter.body.submissions[0].streamer_name).toBe('RIVAL');

    const ids = all.body.submissions.map((row) => row.id);
    const bulk = await ctx.admin.post('/api/admin/submissions/bulk', {
      ids,
      action: 'approve',
      note: 'looks good',
    });
    expect(bulk.status).toBe(200);
    expect(bulk.body.changed).toBe(3);
    expect(bulk.body.results.every((row) => row.status === 'approved')).toBe(true);
    expect(bulk.body.results.filter((row) => row.completion_created)).toHaveLength(2);

    // Approving twice is a conflict, not a crash.
    const again = await ctx.admin.post('/api/admin/submissions/bulk', { ids, action: 'approve' });
    expect(again.body.changed).toBe(0);
    expect(again.body.results.every((row) => row.error === 'already_reviewed')).toBe(true);

    // Every approval backfilled a completion — but keep-first means the second
    // Samus VOD does not add a duplicate.
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM completions').get().n).toBe(2);

    const audit = ctx.db
      .prepare("SELECT action, detail FROM audit_log WHERE action = 'submission_bulk_approve'")
      .get();
    expect(JSON.parse(audit.detail)).toMatchObject({ changed: 3 });
  });

  it('manages accounts, roles and the primary streamer', async () => {
    const ctx = await setup(it);

    const found = await ctx.admin.get('/api/admin/users?q=nairomk&role=streamer');
    expect(found.body.total).toBe(1);
    expect(found.body.users[0].roles).toEqual(['streamer']);

    // Roles can be handed out, and the change shows up on the next request.
    const granted = await ctx.admin.post(`/api/admin/users/${ctx.streamerId}/roles`, {
      role: 'admin',
      action: 'grant',
    });
    expect(granted.body.roles).toEqual(['admin', 'streamer']);
    const asAdmin = await ctx.streamer.get('/api/admin/users');
    expect(asAdmin.status).toBe(200);
    expect(
      (await ctx.admin.post(`/api/admin/users/${ctx.streamerId}/roles`, {
        role: 'admin',
        action: 'revoke',
      })).body.roles,
    ).toEqual(['streamer']);

    // Nobody may demote themselves.
    expect(
      (await ctx.admin.post(`/api/admin/users/${ctx.adminId}/status`, { status: 'suspended' })).status,
    ).toBe(400);
    expect(
      (await ctx.admin.post(`/api/admin/users/${ctx.adminId}/roles`, {
        role: 'admin',
        action: 'revoke',
      })).body.error,
    ).toBe('self');

    const primary = await ctx.admin.post('/api/admin/settings/primary-streamer', {
      user_id: ctx.streamerId,
    });
    expect(primary.body.primary_streamer_id).toBe(ctx.streamerId);

    // The featured streamer stays a streamer.
    const demote = await ctx.admin.post(`/api/admin/users/${ctx.streamerId}/roles`, {
      role: 'streamer',
      action: 'revoke',
    });
    expect(demote.status).toBe(400);
    expect(demote.body.error).toBe('primary_streamer');
    expect(
      ctx.db
        .prepare(
          `SELECT COUNT(*) AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = ? AND r.name = 'streamer'`,
        )
        .get(ctx.streamerId).n,
    ).toBe(1);

    // A pending account cannot be featured.
    await ctx.anon.post('/api/auth/register', {
      username: 'waiting',
      password: 'password123',
      display_name: 'Waiting',
      youtube_url: 'https://www.youtube.com/@waiting',
    });
    const waitingId = ctx.db.prepare("SELECT id FROM users WHERE username = 'waiting'").get().id;
    const notStreamer = await ctx.admin.post('/api/admin/settings/primary-streamer', {
      user_id: waitingId,
    });
    expect(notStreamer.status).toBe(400);
    expect(notStreamer.body.error).toBe('not_a_streamer');

    const suspended = await ctx.admin.post(`/api/admin/users/${ctx.streamerId}/status`, {
      status: 'suspended',
    });
    expect(suspended.body.status).toBe('suspended');
    const list = await ctx.admin.get('/api/admin/users?status=suspended');
    expect(list.body.users.map((row) => row.id)).toContain(ctx.streamerId);
  });

  it('adds and revokes completions with an audit trail', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');

    const created = await ctx.admin.post('/api/admin/completions', {
      streamer_id: ctx.streamerId,
      character_id: samus,
      duration_seconds: 3723,
      attempts_count: 4,
    });
    expect(created.status).toBe(201);

    const dupe = await ctx.admin.post('/api/admin/completions', {
      streamer_id: ctx.streamerId,
      character_id: samus,
    });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe('already_completed');

    const list = await ctx.admin.get(`/api/admin/completions?streamer_id=${ctx.streamerId}`);
    expect(list.body.total).toBe(1);
    expect(list.body.completions[0]).toMatchObject({
      character: { slug: 'samus', name: 'Samus' },
      streamer_name: 'Nai',
      duration_seconds: 3723,
      attempts_count: 4,
    });

    const timeline = await ctx.anon.get('/api/timeline');
    expect(timeline.body.events.some((event) => event.type === 'completion')).toBe(true);

    const id = list.body.completions[0].id;
    expect((await ctx.admin.del(`/api/admin/completions/${id}`)).status).toBe(200);
    expect((await ctx.admin.get('/api/admin/completions')).body.total).toBe(0);

    const actions = ctx.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'completion_%' ORDER BY id")
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(['completion_added', 'completion_revoked']);
  });

  it('snapshots the daily vote and resets a day', async () => {
    const ctx = await setup(it);
    const yesterday = utcDay(Date.now() - 86_400_000);
    const today = utcDay();
    const samus = ctx.charId('samus');
    const mario = ctx.charId('mario');

    const insert = ctx.db.prepare(
      'INSERT INTO votes (ip_hash, character_id, utc_day, created_at) VALUES (?, ?, ?, ?)',
    );
    const at = new Date().toISOString();
    insert.run('a'.repeat(64), samus, yesterday, at);
    insert.run('b'.repeat(64), samus, yesterday, at);
    insert.run('c'.repeat(64), mario, yesterday, at);
    insert.run('d'.repeat(64), mario, today, at);

    const history = await ctx.admin.get('/api/admin/votes?days=14');
    expect(history.status).toBe(200);
    expect(history.body.winners).toHaveLength(1);
    expect(history.body.winners[0]).toMatchObject({
      utc_day: yesterday,
      votes: 2,
      character: { slug: 'samus' },
    });
    expect(history.body.live.map((row) => row.utc_day)).toEqual([today, yesterday]);

    // Today is never snapshotted.
    expect(history.body.winners.some((row) => row.utc_day === today)).toBe(false);

    const reset = await ctx.admin.post('/api/admin/votes/reset', { day: yesterday });
    expect(reset.body).toMatchObject({ utc_day: yesterday, removed: 3 });
    expect(
      ctx.db.prepare('SELECT COUNT(*) AS n FROM vote_daily_winners WHERE utc_day = ?').get(yesterday)
        .n,
    ).toBe(0);

    // A single character can be dropped without touching the rest of the day.
    const partial = await ctx.admin.post('/api/admin/votes/reset', {
      day: today,
      character_id: mario,
    });
    expect(partial.body.removed).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM votes').get().n).toBe(0);
    expect(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'votes_reset'").get().n,
    ).toBe(2);
  });

  it('edits the roster and refuses a duplicate select order', async () => {
    const ctx = await setup(it);
    const mario = ctx.charId('mario');
    const link = ctx.charId('link');

    const saved = await ctx.admin.patch(`/api/admin/characters/${mario}`, {
      name: 'Mario',
      series: 'Super Mario',
      is_echo: true,
    });
    expect(saved.status).toBe(200);

    const list = await ctx.admin.get('/api/admin/characters');
    expect(list.body.characters).toHaveLength(86);
    expect(list.body.characters.find((row) => row.id === mario)).toMatchObject({
      name: 'Mario',
      series: 'Super Mario',
      is_echo: 1,
    });

    const taken = await ctx.db
      .prepare('SELECT select_order FROM characters WHERE id = ?')
      .get(mario).select_order;
    const clash = await ctx.admin.patch(`/api/admin/characters/${link}`, {
      select_order: taken,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('select_order_taken');

    expect(
      (await ctx.admin.patch('/api/admin/characters/9999', { name: 'Ghost' })).status,
    ).toBe(404);
    expect(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'character_updated'").get().n,
    ).toBe(1);
  });

  it('lists the audit log, filtered by action', async () => {
    const ctx = await setup(it);
    await addStreamer(ctx, 'rival');
    await ctx.admin.post(`/api/admin/users/${ctx.streamerId}/roles`, {
      role: 'admin',
      action: 'grant',
    });

    const all = await ctx.admin.get('/api/admin/audit?limit=100');
    expect(all.body.total).toBeGreaterThanOrEqual(3);
    expect(all.body.entries.length).toBe(all.body.total);

    const filtered = await ctx.admin.get('/api/admin/audit?action=role_grant');
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.entries[0]).toMatchObject({ action: 'role_grant', target_type: 'user' });
    expect(filtered.body.entries[0].actor_username).toBe('admin');

    const paged = await ctx.admin.get('/api/admin/audit?limit=1&offset=1');
    expect(paged.body.entries).toHaveLength(1);
    expect(paged.body.total).toBe(all.body.total);
  });
});
