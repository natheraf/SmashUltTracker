import { nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { requireCharacter } from './streaks.js';
import { addTimelineEvent } from './timeline.js';
import { fetchVideoTitle, parseStartTimestamp, parseYouTubeUrl, thumbnailFor } from './youtube.js';

/**
 * Fan-submitted VODs. Submissions land in a review queue unless the submitter
 * holds review_submissions (then they are approved on the spot). Approving a
 * VOD on a fighter the streamer has not completed yet backfills a completion —
 * a VOD is evidence the run happened, even if the tracker missed it.
 */

const STATUSES = new Set(['pending', 'approved', 'rejected']);

const VIEW_SELECT = `
  SELECT v.id, v.streamer_id, v.character_id, v.youtube_url, v.video_id, v.title,
         v.thumbnail, v.start_timestamp, v.completion_date, v.note, v.submitter_handle,
         v.status, v.review_note, v.reviewed_at, v.created_at,
         c.slug AS character_slug, c.name AS character_name,
         u.display_name AS streamer_name
  FROM vod_submissions v
  JOIN characters c ON c.id = v.character_id
  JOIN users u ON u.id = v.streamer_id`;

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    streamer_id: row.streamer_id,
    streamer_name: row.streamer_name,
    character: { id: row.character_id, slug: row.character_slug, name: row.character_name },
    youtube_url: row.youtube_url,
    video_id: row.video_id,
    title: row.title,
    thumbnail: row.thumbnail,
    start_timestamp: row.start_timestamp,
    completion_date: row.completion_date,
    note: row.note,
    submitter_handle: row.submitter_handle,
    status: row.status,
    review_note: row.review_note,
    reviewed_at: row.reviewed_at,
    created_at: row.created_at,
  };
}

export function submissionById(db, id) {
  return view(db.prepare(`${VIEW_SELECT} WHERE v.id = ?`).get(id));
}

/** Review queue, newest first. `status: 'all'` returns everything. */
export function listSubmissions(
  db,
  { status = 'pending', streamerId = null, characterId = null, limit = 50, offset = 0 } = {},
) {
  const clauses = [];
  const params = [];
  if (status !== 'all') {
    if (!STATUSES.has(status)) throw badRequest('Unknown status', 'bad_status');
    clauses.push('v.status = ?');
    params.push(status);
  }
  if (streamerId) {
    clauses.push('v.streamer_id = ?');
    params.push(streamerId);
  }
  if (characterId) {
    clauses.push('v.character_id = ?');
    params.push(characterId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${VIEW_SELECT}${where} ORDER BY v.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM vod_submissions v${where}`).get(...params).n;
  return { submissions: rows.map(view), total };
}

/** YYYY-MM-DD or null; anything else is rejected. */
function normalizeCompletionDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const trimmed = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw badRequest('Completion date must be YYYY-MM-DD', 'invalid_completion_date');
  }
  const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) throw badRequest('Invalid completion date', 'invalid_completion_date');
  return trimmed;
}

/**
 * Creates (or re-opens a previously rejected) submission. Returns the view plus
 * whether an auto-approval backfilled a completion.
 */
export async function createSubmission(
  db,
  {
    streamerId,
    characterId,
    youtubeUrl,
    startTimestamp = null,
    completionDate = null,
    note = null,
    submitterHandle = null,
    ipHash = 'unknown',
    autoApprove = false,
    reviewerId = null,
    fetchTitle = fetchVideoTitle,
    at = Date.now(),
  },
) {
  requireCharacter(db, characterId);
  const streamer = db
    .prepare("SELECT id FROM users WHERE id = ? AND status = 'approved'")
    .get(streamerId);
  if (!streamer) throw notFound('No such streamer');

  const parsed = parseYouTubeUrl(youtubeUrl);
  if (!parsed) throw badRequest('Paste a YouTube video link', 'invalid_youtube_url');

  const hasStart = startTimestamp !== null && startTimestamp !== undefined && startTimestamp !== '';
  const start = parseStartTimestamp(startTimestamp);
  if (hasStart && start === null) {
    throw badRequest('Start timestamp must look like 1:35 or 95', 'invalid_timestamp');
  }
  const date = normalizeCompletionDate(completionDate);
  const createdAt = new Date(at).toISOString();
  const title = fetchTitle ? await fetchTitle(parsed.video_id).catch(() => null) : null;
  const thumbnail = thumbnailFor(parsed.video_id);
  const status = autoApprove ? 'approved' : 'pending';

  const existing = db
    .prepare(
      'SELECT id, status FROM vod_submissions WHERE streamer_id = ? AND character_id = ? AND video_id = ?',
    )
    .get(streamerId, characterId, parsed.video_id);

  let id;
  if (existing) {
    if (existing.status !== 'rejected') {
      throw conflict('That video was already submitted for this fighter', 'duplicate_submission');
    }
    db.prepare(
      `UPDATE vod_submissions
          SET youtube_url = ?, title = ?, thumbnail = ?, start_timestamp = ?, completion_date = ?,
              note = ?, submitter_handle = ?, ip_hash = ?, status = ?,
              reviewer_id = NULL, review_note = NULL, reviewed_at = NULL, created_at = ?
        WHERE id = ?`,
    ).run(
      parsed.youtube_url,
      title,
      thumbnail,
      start,
      date,
      note,
      submitterHandle,
      ipHash,
      status,
      createdAt,
      existing.id,
    );
    id = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO vod_submissions
           (streamer_id, character_id, youtube_url, video_id, title, thumbnail, start_timestamp,
            completion_date, note, submitter_handle, ip_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        streamerId,
        characterId,
        parsed.youtube_url,
        parsed.video_id,
        title,
        thumbnail,
        start,
        date,
        note,
        submitterHandle,
        ipHash,
        status,
        createdAt,
      );
    id = Number(info.lastInsertRowid);
  }

  let completion = null;
  if (autoApprove) {
    db.prepare('UPDATE vod_submissions SET reviewer_id = ?, reviewed_at = ? WHERE id = ?').run(
      reviewerId,
      createdAt,
      id,
    );
    completion = approveSideEffects(db, id);
  }
  return { submission: submissionById(db, id), completion };
}

/**
 * Records an approval: a completion is created only when the fighter has none
 * (keep-first — the tracker's own completion always wins) and a timeline event
 * announces the approved VOD.
 */
function approveSideEffects(db, id) {
  const row = db.prepare('SELECT * FROM vod_submissions WHERE id = ?').get(id);
  const existing = db
    .prepare('SELECT id FROM completions WHERE streamer_id = ? AND character_id = ?')
    .get(row.streamer_id, row.character_id);

  let completionCreated = false;
  if (!existing) {
    const completedAt = row.completion_date
      ? `${row.completion_date}T00:00:00.000Z`
      : row.created_at;
    db.prepare(
      `INSERT INTO completions (streamer_id, character_id, completed_at, duration_seconds, attempts_count, created_at)
       VALUES (?, ?, ?, 0, 1, ?)`,
    ).run(row.streamer_id, row.character_id, completedAt, nowIso());
    completionCreated = true;
  }

  addTimelineEvent(db, {
    type: 'vod_approved',
    streamerId: row.streamer_id,
    characterId: row.character_id,
    payload: { video_id: row.video_id, completion_created: completionCreated },
  });

  return { created: completionCreated };
}

/** Approve or reject a pending submission. */
export function reviewSubmission(db, id, { action, reviewerId, note = null, at = Date.now() }) {
  const row = db.prepare('SELECT * FROM vod_submissions WHERE id = ?').get(id);
  if (!row) throw notFound('No such submission');
  if (row.status !== 'pending') {
    throw conflict(`Submission is already ${row.status}`, 'already_reviewed');
  }
  const reviewedAt = new Date(at).toISOString();
  db.prepare(
    `UPDATE vod_submissions SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ?
     WHERE id = ?`,
  ).run(action === 'approve' ? 'approved' : 'rejected', reviewerId, note, reviewedAt, id);

  const completion = action === 'approve' ? approveSideEffects(db, id) : null;
  return { submission: submissionById(db, id), completion };
}

/** Per-status submission counts for the admin overview. */
export function submissionCounts(db) {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM vod_submissions GROUP BY status')
    .all();
  const counts = { pending: 0, approved: 0, rejected: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.total += row.n;
  }
  return counts;
}
