import { describe, expect, it } from 'vitest';
import { approvedStreamer, makeClient, setupTestServer } from '../tests/helpers.js';
import { parseStartTimestamp, parseYouTubeUrl } from '../server/services/youtube.js';

describe('youtube url parsing', () => {
  it('accepts the link shapes people paste', () => {
    const cases = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=90s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=90',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ];
    for (const url of cases) {
      expect(parseYouTubeUrl(url)).toEqual({
        video_id: 'dQw4w9WgXcQ',
        youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
    }
  });

  it('rejects non-youtube and malformed input', () => {
    const bad = [
      '',
      null,
      'not a url',
      'javascript:alert(1)',
      'https://vimeo.com/12345',
      'https://www.youtube.com/watch?v=too-short',
      'https://www.youtube.com/playlist?list=PL1234567890',
      'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    ];
    for (const url of bad) expect(parseYouTubeUrl(url)).toBeNull();
  });

  it('parses start timestamps in both formats', () => {
    expect(parseStartTimestamp('95')).toBe(95);
    expect(parseStartTimestamp(95)).toBe(95);
    expect(parseStartTimestamp('1:35')).toBe(95);
    expect(parseStartTimestamp('1:02:03')).toBe(3723);
    expect(parseStartTimestamp('')).toBeNull();
    expect(parseStartTimestamp(null)).toBeNull();
    expect(parseStartTimestamp('later')).toBeNull();
    expect(parseStartTimestamp('1:2:3:4')).toBeNull();
  });
});

/** Fresh server + an approved streamer, per test. */
async function setup(t) {
  const ctx = await setupTestServer(t);
  const streamer = await approvedStreamer(ctx);
  const streamerId = ctx.db.prepare("SELECT id FROM users WHERE username = 'nairomk'").get().id;
  const charId = (slug) => ctx.db.prepare('SELECT id FROM characters WHERE slug = ?').get(slug).id;
  const admin = makeClient(ctx.base);
  await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
  return { ...ctx, streamer, streamerId, charId, admin, anon: makeClient(ctx.base) };
}

describe('vod submissions', () => {
  it('queues an anonymous submission for review', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');

    const res = await ctx.anon.post('/api/submissions', {
      streamer_id: ctx.streamerId,
      character_id: samus,
      youtube_url: 'https://youtu.be/dQw4w9WgXcQ?t=95',
      start_timestamp: '1:35',
      completion_date: '2026-02-03',
      submitter_handle: '@fan',
      note: 'the run ends around 1:35',
    });

    expect(res.status).toBe(201);
    expect(res.body.submission).toMatchObject({
      status: 'pending',
      video_id: 'dQw4w9WgXcQ',
      youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      start_timestamp: 95,
      completion_date: '2026-02-03',
      submitter_handle: '@fan',
      note: 'the run ends around 1:35',
      reviewed_at: null,
    });
    expect(res.body.submission.thumbnail).toContain('dQw4w9WgXcQ');
    expect(res.body.completion).toBeNull();

    // The raw IP is never stored — only its salted hash.
    const row = ctx.db.prepare('SELECT ip_hash FROM vod_submissions WHERE id = ?').get(
      res.body.submission.id,
    );
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    // Pending VODs stay out of the public character dialog.
    const detail = await ctx.anon.get(`/api/streamers/${ctx.streamerId}/characters/${samus}`);
    expect(detail.body.vods).toEqual([]);
  });

  it('rejects duplicates and bad input', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');
    const body = {
      streamer_id: ctx.streamerId,
      character_id: samus,
      youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    };

    expect((await ctx.anon.post('/api/submissions', body)).status).toBe(201);
    const dupe = await ctx.anon.post('/api/submissions', body);
    expect(dupe.status).toBe(409);
    expect(dupe.body.error).toBe('duplicate_submission');

    const badUrl = await ctx.anon.post('/api/submissions', { ...body, youtube_url: 'nope' });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error).toBe('invalid_youtube_url');

    const badStart = await ctx.anon.post('/api/submissions', {
      ...body,
      youtube_url: 'https://youtu.be/aaaaaaaaaaa',
      start_timestamp: 'soon',
    });
    expect(badStart.status).toBe(400);
    expect(badStart.body.error).toBe('invalid_timestamp');

    const badDate = await ctx.anon.post('/api/submissions', {
      ...body,
      youtube_url: 'https://youtu.be/bbbbbbbbbbb',
      completion_date: 'yesterday',
    });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe('invalid_completion_date');

    const badCharacter = await ctx.anon.post('/api/submissions', {
      ...body,
      character_id: 9999,
      youtube_url: 'https://youtu.be/ccccccccccc',
    });
    expect(badCharacter.status).toBe(400);
    expect(badCharacter.body.error).toBe('unknown_character');

    const badStreamer = await ctx.anon.post('/api/submissions', {
      ...body,
      streamer_id: 9999,
      youtube_url: 'https://youtu.be/ddddddddddd',
    });
    expect(badStreamer.status).toBe(404);
  });

  it('re-opens a rejected submission instead of dead-ending the link', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');
    const body = {
      streamer_id: ctx.streamerId,
      character_id: samus,
      youtube_url: 'https://youtu.be/dQw4w9WgXcQ',
    };

    const first = await ctx.anon.post('/api/submissions', body);
    await ctx.admin.post(`/api/admin/submissions/${first.body.submission.id}/reject`, {
      note: 'wrong fighter',
    });

    const again = await ctx.anon.post('/api/submissions', { ...body, note: 'fixed now' });
    expect(again.status).toBe(201);
    expect(again.body.submission).toMatchObject({ status: 'pending', note: 'fixed now' });
    expect(again.body.submission.review_note).toBeNull();
    expect(
      ctx.db.prepare('SELECT COUNT(*) AS n FROM vod_submissions').get().n,
    ).toBe(1);
  });

  it('auto-approves an admin submission and backfills the completion', async () => {
    const ctx = await setup(it);
    const samus = ctx.charId('samus');

    const res = await ctx.admin.post('/api/submissions', {
      streamer_id: ctx.streamerId,
      character_id: samus,
      youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      completion_date: '2026-02-03',
    });

    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe('approved');
    expect(res.body.submission.reviewed_at).toBeTruthy();
    expect(res.body.completion).toMatchObject({ created: true });

    const completion = ctx.db
      .prepare('SELECT * FROM completions WHERE streamer_id = ? AND character_id = ?')
      .get(ctx.streamerId, samus);
    expect(completion.completed_at).toBe('2026-02-03T00:00:00.000Z');
    expect(completion.attempts_count).toBe(1);

    const audit = ctx.db
      .prepare("SELECT action FROM audit_log WHERE action = 'submission_auto_approved'")
      .get();
    expect(audit).toBeTruthy();

    // An approved VOD shows up publicly with its start offset.
    const detail = await ctx.anon.get(`/api/streamers/${ctx.streamerId}/characters/${samus}`);
    expect(detail.body.vods).toHaveLength(1);
    expect(detail.body.completion).toBeTruthy();

    const timeline = await ctx.anon.get('/api/timeline');
    const event = timeline.body.events.find((e) => e.type === 'vod_approved');
    expect(event.character.slug).toBe('samus');
    expect(event.payload).toMatchObject({ video_id: 'dQw4w9WgXcQ', completion_created: true });
  });
});
