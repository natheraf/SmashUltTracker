import { badRequest, conflict } from '../errors.js';
import { requireCharacter } from './streaks.js';
import { addTimelineEvent } from './timeline.js';
import { utcDay } from './youtube.js';

/**
 * The "who's next?" community vote. One vote per visitor (salted IP hash) per
 * UTC day, enforced by the votes table's UNIQUE(ip_hash, utc_day).
 *
 * A background job snapshots finished days into vote_daily_winners — the home
 * page keeps reading the live tallies, so a rolling 30-day window never needs a
 * separate aggregation.
 */

const DAY_MS = 86_400_000;

export function castVote(db, { ipHash, characterId, at = Date.now() }) {
  requireCharacter(db, characterId);
  const day = utcDay(at);
  const existing = db
    .prepare('SELECT character_id FROM votes WHERE ip_hash = ? AND utc_day = ?')
    .get(ipHash, day);
  if (existing) throw conflict('You already voted today', 'already_voted');

  try {
    db.prepare('INSERT INTO votes (ip_hash, character_id, utc_day, created_at) VALUES (?, ?, ?, ?)').run(
      ipHash,
      characterId,
      day,
      new Date(at).toISOString(),
    );
  } catch (err) {
    // Unique violation from a concurrent double-click.
    if (String(err.message).includes('UNIQUE')) {
      throw conflict('You already voted today', 'already_voted');
    }
    throw err;
  }
  return { utc_day: day, character_id: characterId };
}

/**
 * Everything the vote block needs in one read: candidates (fighters the primary
 * streamer has not completed), today's and the 30-day top lists, the visitor's
 * own vote and the most recent daily winner.
 */
export function voteStandings(
  db,
  { streamerId = null, visitorHash = null, at = Date.now(), days = 30, top = 5 } = {},
) {
  const day = utcDay(at);
  const monthStart = utcDay(at - (days - 1) * DAY_MS);

  const completed = new Set(
    streamerId
      ? db
          .prepare('SELECT character_id FROM completions WHERE streamer_id = ?')
          .all(streamerId)
          .map((row) => row.character_id)
      : [],
  );

  const rows = db
    .prepare(
      `SELECT c.id, c.slug, c.name, c.series, c.select_order,
              SUM(CASE WHEN v.utc_day = ? THEN 1 ELSE 0 END) AS today_votes,
              COUNT(v.id) AS month_votes
         FROM characters c
         LEFT JOIN votes v ON v.character_id = c.id AND v.utc_day >= ?
        GROUP BY c.id
        ORDER BY c.select_order ASC`,
    )
    .all(day, monthStart);

  const shape = (row) => ({
    character: { id: row.id, slug: row.slug, name: row.name, series: row.series },
    today_votes: row.today_votes,
    month_votes: row.month_votes,
  });

  const byMonth = (a, b) => b.month_votes - a.month_votes || a.character.id - b.character.id;
  const byToday = (a, b) => b.today_votes - a.today_votes || a.character.id - b.character.id;

  const candidates = rows
    .filter((row) => !completed.has(row.id))
    .map(shape);
  const todayTop = candidates
    .filter((row) => row.today_votes > 0)
    .sort(byToday)
    .slice(0, top);
  const monthTop = rows
    .map(shape)
    .filter((row) => row.month_votes > 0)
    .sort(byMonth)
    .slice(0, top);

  const myVoteRow = visitorHash
    ? db
        .prepare('SELECT character_id FROM votes WHERE ip_hash = ? AND utc_day = ?')
        .get(visitorHash, day)
    : null;

  const winnerRow = db
    .prepare(
      `SELECT w.utc_day, w.character_id, w.votes, c.slug, c.name
         FROM vote_daily_winners w JOIN characters c ON c.id = w.character_id
        ORDER BY w.utc_day DESC LIMIT 1`,
    )
    .get();

  return {
    utc_day: day,
    days,
    streamer_id: streamerId,
    candidates,
    today: {
      top: todayTop,
      total: candidates.reduce((sum, row) => sum + row.today_votes, 0),
    },
    month: {
      top: monthTop,
      total: monthTop.reduce((sum, row) => sum + row.month_votes, 0),
    },
    my_vote: myVoteRow ? myVoteRow.character_id : null,
    winner: winnerRow
      ? {
          utc_day: winnerRow.utc_day,
          votes: winnerRow.votes,
          character: { id: winnerRow.character_id, slug: winnerRow.slug, name: winnerRow.name },
        }
      : null,
  };
}

/**
 * Snapshots every finished UTC day that still has votes but no winner row, and
 * announces each one on the timeline. Idempotent, so it is safe to run on a
 * schedule and again on demand when the vote list is opened.
 */
export function recordDailyWinners(db, { at = Date.now(), limit = 60 } = {}) {
  const today = utcDay(at);
  const days = db
    .prepare(
      `SELECT utc_day FROM votes
        WHERE utc_day < ? AND utc_day NOT IN (SELECT utc_day FROM vote_daily_winners)
        GROUP BY utc_day ORDER BY utc_day ASC LIMIT ?`,
    )
    .all(today, limit);

  for (const { utc_day: day } of days) {
    const top = db
      .prepare(
        `SELECT character_id, COUNT(*) AS votes FROM votes
          WHERE utc_day = ? GROUP BY character_id
          ORDER BY votes DESC, character_id ASC LIMIT 1`,
      )
      .get(day);
    if (!top) continue;
    db.prepare(
      'INSERT OR IGNORE INTO vote_daily_winners (utc_day, character_id, votes) VALUES (?, ?, ?)',
    ).run(day, top.character_id, top.votes);
    addTimelineEvent(db, {
      type: 'vote_winner',
      characterId: top.character_id,
      payload: { utc_day: day, votes: top.votes },
    });
  }
  return days.length;
}

/** Admin: drop a day's votes and its winner snapshot. */
export function resetVotes(db, { day = utcDay(), characterId = null } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest('Invalid day', 'invalid_day');
  const votes = characterId
    ? db.prepare('DELETE FROM votes WHERE utc_day = ? AND character_id = ?').run(day, characterId)
    : db.prepare('DELETE FROM votes WHERE utc_day = ?').run(day);
  db.prepare('DELETE FROM vote_daily_winners WHERE utc_day = ?').run(day);
  return { utc_day: day, removed: votes.changes };
}

/** Admin history: recorded winners plus today's live tally. */
export function voteHistory(db, { at = Date.now(), days = 14 } = {}) {
  const today = utcDay(at);
  const winners = db
    .prepare(
      `SELECT w.utc_day, w.votes, c.id, c.slug, c.name
         FROM vote_daily_winners w JOIN characters c ON c.id = w.character_id
        ORDER BY w.utc_day DESC LIMIT ?`,
    )
    .all(days);
  const live = db
    .prepare(
      `SELECT v.utc_day, COUNT(*) AS total,
              (SELECT c2.slug FROM votes v2 JOIN characters c2 ON c2.id = v2.character_id
                WHERE v2.utc_day = v.utc_day GROUP BY v2.character_id
                ORDER BY COUNT(*) DESC, v2.character_id ASC LIMIT 1) AS leader_slug
         FROM votes v WHERE v.utc_day >= ? GROUP BY v.utc_day ORDER BY v.utc_day DESC`,
    )
    .all(utcDay(at - days * DAY_MS));
  return {
    today,
    winners: winners.map((row) => ({
      utc_day: row.utc_day,
      votes: row.votes,
      character: { id: row.id, slug: row.slug, name: row.name },
    })),
    live: live.map((row) => ({
      utc_day: row.utc_day,
      total: row.total,
      leader_slug: row.leader_slug,
    })),
  };
}
