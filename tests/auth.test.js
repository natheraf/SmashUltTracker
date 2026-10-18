import { beforeEach, describe, expect, it } from 'vitest';
import { makeClient, setupTestServer } from './helpers.js';

let ctx;
beforeEach(async (t) => {
  ctx = await setupTestServer(t);
});

describe('admin bootstrap', () => {
  it('creates the env admin with all permissions on boot', async () => {
    const res = await ctx.client.post('/api/auth/login', {
      username: 'admin',
      password: 'testadminpass1',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('approved');
    expect(res.body.user.roles).toContain('admin');
    for (const perm of [
      'review_submissions',
      'approve_streamers',
      'manage_users',
      'manage_characters',
      'revoke_completions',
      'use_tracker',
    ]) {
      expect(res.body.user.permissions).toContain(perm);
    }
  });

  it('does not create a second admin on re-boot', async () => {
    const count = ctx.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username = 'admin'").get();
    expect(count.n).toBe(1);
  });
});

describe('registration', () => {
  it('creates a pending account that can log in but has no permissions', async () => {
    const reg = await ctx.client.post('/api/auth/register', {
      username: 'nairomk',
      password: 'password123',
      display_name: 'nairomk',
      youtube_url: 'https://youtube.com/@nairomk',
      twitch_url: 'https://twitch.tv/nairomk',
    });
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('pending');

    const login = await ctx.client.post('/api/auth/login', {
      username: 'nairomk',
      password: 'password123',
    });
    expect(login.status).toBe(200);
    expect(login.body.user.status).toBe('pending');
    expect(login.body.user.permissions).toEqual([]);

    const me = await ctx.client.get('/api/auth/me');
    expect(me.body.user.username).toBe('nairomk');
  });

  it('rejects duplicate usernames case-insensitively', async () => {
    await ctx.client.post('/api/auth/register', {
      username: 'nairomk',
      password: 'password123',
      display_name: 'nairomk',
      twitch_url: 'https://twitch.tv/nairomk',
    });
    const dup = await ctx.client.post('/api/auth/register', {
      username: 'Nairomk',
      password: 'password123',
      display_name: 'impostor',
      twitch_url: 'https://twitch.tv/x',
    });
    expect(dup.status).toBe(409);
  });

  it('requires at least one social URL and valid hosts', async () => {
    const noSocial = await ctx.client.post('/api/auth/register', {
      username: 'someone',
      password: 'password123',
      display_name: 'Someone',
    });
    expect(noSocial.status).toBe(400);

    const badHost = await ctx.client.post('/api/auth/register', {
      username: 'someone',
      password: 'password123',
      display_name: 'Someone',
      youtube_url: 'https://evil.example.com/watch?v=abc',
    });
    expect(badHost.status).toBe(400);
    expect(badHost.body.error).toBe('invalid_youtube');
  });

  it('validates username and password shape', async () => {
    const res = await ctx.client.post('/api/auth/register', {
      username: 'a!',
      password: 'short',
      display_name: '',
      twitch_url: 'https://twitch.tv/x',
    });
    expect(res.status).toBe(400);
    expect(res.body.details.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CSRF protection', () => {
  it('rejects JSON mutations without the custom header', async () => {
    const res = await ctx.client.post(
      '/api/auth/login',
      { username: 'admin', password: 'testadminpass1' },
      { csrf: false },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf');
  });

  it('allows GET without the header', async () => {
    const res = await ctx.client.get('/api/auth/me', { csrf: false });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

describe('login rules', () => {
  it('blocks rejected and suspended accounts', async () => {
    await ctx.client.post('/api/auth/register', {
      username: 'baduser',
      password: 'password123',
      display_name: 'Bad',
      twitch_url: 'https://twitch.tv/bad',
    });
    const id = ctx.db.prepare("SELECT id FROM users WHERE username = 'baduser'").get().id;

    const admin = makeClient(ctx.base);
    await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
    await admin.post(`/api/admin/streamers/${id}/reject`, { note: 'no' });

    const login = await ctx.client.post('/api/auth/login', {
      username: 'baduser',
      password: 'password123',
    });
    expect(login.status).toBe(403);

    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(id);
    const suspended = await ctx.client.post('/api/auth/login', {
      username: 'baduser',
      password: 'password123',
    });
    expect(suspended.status).toBe(403);
  });

  it('rejects wrong passwords and unknown users with 401', async () => {
    const wrong = await ctx.client.post('/api/auth/login', {
      username: 'admin',
      password: 'notthepassword',
    });
    expect(wrong.status).toBe(401);
    const unknown = await ctx.client.post('/api/auth/login', {
      username: 'ghost',
      password: 'whatever123',
    });
    expect(unknown.status).toBe(401);
  });

  it('logs out by destroying the session', async () => {
    await ctx.client.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
    expect((await ctx.client.get('/api/auth/me')).body.user).not.toBeNull();
    await ctx.client.post('/api/auth/logout');
    expect((await ctx.client.get('/api/auth/me')).body.user).toBeNull();
  });
});

describe('streamer approval and roles', () => {
  async function approveFlow() {
    await ctx.client.post('/api/auth/register', {
      username: 'nairomk',
      password: 'password123',
      display_name: 'nairomk',
      youtube_url: 'https://youtube.com/@nairomk',
    });
    const id = ctx.db.prepare("SELECT id FROM users WHERE username = 'nairomk'").get().id;
    const admin = makeClient(ctx.base);
    await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
    return { id, admin };
  }

  it('admin sees the pending queue and approval grants the streamer role', async () => {
    const { id, admin } = await approveFlow();
    const queue = await admin.get('/api/admin/streamers');
    expect(queue.body.streamers.map((s) => s.id)).toContain(id);

    const approve = await admin.post(`/api/admin/streamers/${id}/approve`, {});
    expect(approve.status).toBe(200);

    const roles = ctx.db
      .prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?')
      .all(id)
      .map((r) => r.name);
    expect(roles).toContain('streamer');

    // Streamer can now log in and holds use_tracker, but not admin permissions.
    const streamer = makeClient(ctx.base);
    const login = await streamer.post('/api/auth/login', {
      username: 'nairomk',
      password: 'password123',
    });
    expect(login.status).toBe(200);
    expect(login.body.user.status).toBe('approved');
    expect(login.body.user.permissions).toEqual(['use_tracker']);

    // ... and cannot reach admin endpoints.
    const denied = await streamer.get('/api/admin/streamers');
    expect(denied.status).toBe(403);

    // Timeline recorded the join.
    const event = ctx.db
      .prepare("SELECT * FROM timeline_events WHERE type = 'streamer_joined'")
      .get();
    expect(event.streamer_id).toBe(id);

    // Audit log has the approval.
    const audit = ctx.db.prepare("SELECT * FROM audit_log WHERE action = 'streamer_approved'").get();
    expect(audit).toBeTruthy();
  });

  it('requires login for admin endpoints', async () => {
    const anon = makeClient(ctx.base);
    expect((await anon.get('/api/admin/streamers')).status).toBe(401);
  });
});

describe('profile editing', () => {
  it('lets a logged-in user update display name and socials', async () => {
    await ctx.client.post('/api/auth/register', {
      username: 'nairomk',
      password: 'password123',
      display_name: 'nairomk',
      twitch_url: 'https://twitch.tv/nairomk',
    });
    await ctx.client.post('/api/auth/login', {
      username: 'nairomk',
      password: 'password123',
    });
    const res = await ctx.client.patch('/api/auth/me', {
      display_name: 'nairomk VODs',
      youtube_url: 'https://youtube.com/@nairomk',
      twitch_url: 'https://twitch.tv/nairomk',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.display_name).toBe('nairomk VODs');
    expect(res.body.user.youtube_url).toContain('youtube.com');
  });
});
