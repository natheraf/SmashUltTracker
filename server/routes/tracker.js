import { Router } from 'express';
import { z } from 'zod';
import { requireApprovedUser, requirePermission, requireUser } from '../auth.js';
import { nowIso } from '../db.js';
import { badRequest } from '../errors.js';
import { broadcast } from '../services/bus.js';
import { addTimelineEvent } from '../services/timeline.js';
import {
  checkMilestones,
  completeStreak,
  ensureStreakRow,
  milestoneBit,
  recordStreakAttempt,
  requireCharacter,
} from '../services/streaks.js';
import {
  ACTIVE_WINDOW_MS,
  elapsedSeconds,
  freezeTimer,
  isStreamerInProgress,
  startTimerIfActive,
  syncZeroSince,
  touchHeartbeat,
  ZERO_WINDOW_MS,
} from '../services/timers.js';

const guard = [requireUser, requireApprovedUser, requirePermission('use_tracker')];

const characterIdSchema = z.coerce.number().int().positive();
const winsSchema = z.coerce.number().int().min(0).max(50);
const secondsSchema = z.coerce.number().int().min(0).max(30 * 24 * 3600);

function getTrackerSession(db, streamerId) {
  return db.prepare('SELECT * FROM tracker_sessions WHERE streamer_id = ?').get(streamerId);
}

function getStreak(db, streamerId, characterId) {
  return db
    .prepare('SELECT * FROM streak_progress WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId);
}

function bestStreak(db, streamerId, characterId) {
  const attemptsBest = db
    .prepare(
      'SELECT COALESCE(MAX(wins), 0) AS best FROM attempts WHERE streamer_id = ? AND character_id = ?',
    )
    .get(streamerId, characterId).best;
  const current = getStreak(db, streamerId, characterId)?.wins || 0;
  return Math.max(attemptsBest, current);
}

function attemptsSoFar(db, streamerId, characterId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM attempts WHERE streamer_id = ? AND character_id = ?')
    .get(streamerId, characterId).n + 1; // +1 = the run currently in progress
}

function streakView(db, row, now) {
  const char = db.prepare('SELECT * FROM characters WHERE id = ?').get(row.character_id);
  return {
    character_id: row.character_id,
    slug: char.slug,
    name: char.name,
    wins: row.wins,
    elapsed_seconds: elapsedSeconds(row, now),
    running: Boolean(row.running_since),
    paused: Boolean(row.paused),
    zero_since: row.zero_since,
    milestones_reached: row.milestones_reached,
    best: bestStreak(db, row.streamer_id, row.character_id),
  };
}

/** Freezes the timer of the currently ticking context (streak or ironman). */
function freezeActiveContext(db, streamerId, at = nowIso()) {
  const ts = getTrackerSession(db, streamerId);
  if (!ts) return;
  if (ts.active_mode === 'streak') {
    if (ts.selected_character_id) {
      freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [streamerId, ts.selected_character_id], at);
    }
  } else {
    const run = db
      .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
      .get(streamerId);
    if (run) freezeTimer(db, 'ironman_runs', ['id'], [run.id], at);
  }
}

/** Opens the timer of the newly active context when allowed. */
function startActiveContext(db, streamerId, at = nowIso()) {
  const ts = getTrackerSession(db, streamerId);
  if (!ts) return;
  if (ts.active_mode === 'streak') {
    if (ts.selected_character_id) {
      startTimerIfActive(db, 'streak_progress', ['streamer_id', 'character_id'], [streamerId, ts.selected_character_id], at);
    }
  } else {
    const run = db
      .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
      .get(streamerId);
    if (run) startTimerIfActive(db, 'ironman_runs', ['id'], [run.id], at);
  }
}

function trackerState(db, streamerId) {
  const now = Date.now();
  const ts = getTrackerSession(db, streamerId);
  const mode = ts?.active_mode || 'streak';
  const selectedId = ts?.selected_character_id || null;
  const streaks = db
    .prepare(
      `SELECT sp.* FROM streak_progress sp
       JOIN characters c ON c.id = sp.character_id
       WHERE sp.streamer_id = ? ORDER BY c.select_order`,
    )
    .all(streamerId)
    .map((row) => streakView(db, row, now));
  const active = selectedId ? streaks.find((s) => s.character_id === selectedId) || null : null;
  const run = db
    .prepare("SELECT * FROM ironman_runs WHERE streamer_id = ? AND status = 'active'")
    .get(streamerId);
  return {
    server_time: new Date(now).toISOString(),
    mode,
    selected_character_id: selectedId,
    last_heartbeat: ts?.last_heartbeat || null,
    heartbeat_interval_seconds: 30,
    active_window_seconds: Math.floor(ACTIVE_WINDOW_MS / 1000),
    zero_window_seconds: Math.floor(ZERO_WINDOW_MS / 1000),
    in_progress: isStreamerInProgress(db, streamerId, now),
    streaks,
    active_streak: active,
    ironman: run
      ? { id: run.id, started_at: run.started_at, accumulated_seconds: run.accumulated_seconds, running: Boolean(run.running_since), paused: Boolean(run.paused) }
      : null,
    overlay_token_set: Boolean(ts?.overlay_token),
  };
}

function requireSelectedCharacter(db, streamerId) {
  const ts = getTrackerSession(db, streamerId);
  if (ts?.active_mode && ts.active_mode !== 'streak') {
    throw badRequest('Switch to streak mode first', 'wrong_mode');
  }
  if (!ts?.selected_character_id) {
    throw badRequest('Select a character first', 'no_character_selected');
  }
  return { ts };
}

function requireSelectedStreak(db, streamerId) {
  const { ts } = requireSelectedCharacter(db, streamerId);
  const row = getStreak(db, streamerId, ts.selected_character_id);
  if (!row) throw badRequest('No streak in progress for this character', 'no_active_streak');
  return { ts, row };
}

export function trackerRoutes(db) {
  const router = Router();
  router.use(...guard);

  const setModeStmt = db.prepare(
    'UPDATE tracker_sessions SET active_mode = ?, updated_at = ? WHERE streamer_id = ?',
  );
  const setSelectedStmt = db.prepare(
    'UPDATE tracker_sessions SET selected_character_id = ?, updated_at = ? WHERE streamer_id = ?',
  );

  router.post('/heartbeat', (req, res, next) => {
    try {
      const at = nowIso();
      touchHeartbeat(db, req.user.id, at);
      // A returning tracker page reopens its timer (the finalize job froze it
      // when heartbeats stopped).
      startActiveContext(db, req.user.id, at);
      res.json({ ok: true, server_time: at, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/state', (req, res, next) => {
    try {
      res.json(trackerState(db, req.user.id));
    } catch (err) {
      next(err);
    }
  });

  router.post('/mode', (req, res, next) => {
    try {
      const { mode } = z.object({ mode: z.enum(['streak', 'ironman']) }).parse(req.body);
      const at = nowIso();
      freezeActiveContext(db, req.user.id, at);
      setModeStmt.run(mode, at, req.user.id);
      startActiveContext(db, req.user.id, at);
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/select', (req, res, next) => {
    try {
      const characterId = characterIdSchema.parse(req.body?.character_id);
      requireCharacter(db, characterId);
      const ts = getTrackerSession(db, req.user.id);
      const at = nowIso();
      // Freeze the previously selected character's timer; the streak itself
      // continues — switching characters never resets anything.
      if (ts?.selected_character_id && ts.selected_character_id !== characterId) {
        freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, ts.selected_character_id], at);
      }
      if (!ts) touchHeartbeat(db, req.user.id, at);
      setSelectedStmt.run(characterId, at, req.user.id);
      startTimerIfActive(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, characterId], at);
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/win', (req, res, next) => {
    try {
      const { ts } = requireSelectedCharacter(db, req.user.id);
      const characterId = ts.selected_character_id;
      const at = nowIso();
      // The first +1 creates the row; the timer starts with it.
      ensureStreakRow(db, req.user.id, characterId);
      const row = getStreak(db, req.user.id, characterId);
      const oldWins = row.wins;
      const newWins = Math.min(oldWins + 1, 50);

      db.prepare(
        'UPDATE streak_progress SET wins = ?, updated_at = ? WHERE streamer_id = ? AND character_id = ?',
      ).run(newWins, at, req.user.id, characterId);
      // A fresh row starts timing; a paused one stays paused.
      startTimerIfActive(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, characterId], at);
      syncZeroSince(db, req.user.id, characterId, newWins, at);

      const fresh = getStreak(db, req.user.id, characterId);
      for (const wins of checkMilestones(db, fresh, newWins, oldWins, at)) {
        addTimelineEvent(db, {
          type: 'milestone',
          streamerId: req.user.id,
          characterId,
          payload: { wins },
        });
      }

      let completion = null;
      if (newWins >= 50) {
        completion = completeStreak(db, req.user.id, characterId, at);
        if (completion.completed) {
          // The character is done; drop the selection so the next pick is explicit.
          setSelectedStmt.run(null, at, req.user.id);
        }
      }

      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, wins: newWins, completion, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/loss', (req, res, next) => {
    try {
      const { row } = requireSelectedStreak(db, req.user.id);
      const at = nowIso();
      const characterId = row.character_id;
      const duration = elapsedSeconds(row, Date.parse(at));

      if (row.wins >= 1) {
        recordStreakAttempt(db, req.user.id, characterId, row.wins, duration, 'failed', at);
        if (row.wins >= 10) {
          addTimelineEvent(db, {
            type: 'streak_failed',
            streamerId: req.user.id,
            characterId,
            payload: { wins: row.wins, duration_seconds: duration },
          });
        }
      }
      // Reset the streak and its timer; the attempt was already recorded above.
      db.prepare(
        `UPDATE streak_progress
         SET wins = 0, accumulated_seconds = 0, milestones_reached = 0, zero_since = ?, updated_at = ?
         WHERE streamer_id = ? AND character_id = ?`,
      ).run(at, at, req.user.id, characterId);
      // Keep timing (the character is still selected) unless paused.
      if (row.paused) {
        db.prepare(
          'UPDATE streak_progress SET running_since = NULL WHERE streamer_id = ? AND character_id = ?',
        ).run(req.user.id, characterId);
      } else {
        db.prepare(
          'UPDATE streak_progress SET running_since = ? WHERE streamer_id = ? AND character_id = ?',
        ).run(at, req.user.id, characterId);
      }

      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/set', (req, res, next) => {
    try {
      const { wins } = z.object({ wins: winsSchema }).parse(req.body);
      const { ts } = requireSelectedStreak(db, req.user.id);
      const characterId = ts.selected_character_id;
      const at = nowIso();
      const row = getStreak(db, req.user.id, characterId);
      const oldWins = row.wins;

      // Milestone bitmask updates silently: corrections must not re-fire
      // timeline events the streamer already earned live.
      db.prepare(
        'UPDATE streak_progress SET wins = ?, updated_at = ? WHERE streamer_id = ? AND character_id = ?',
      ).run(wins, at, req.user.id, characterId);
      const fresh = getStreak(db, req.user.id, characterId);
      checkMilestones(db, fresh, wins, oldWins, at);
      syncZeroSince(db, req.user.id, characterId, wins, at);

      let completion = null;
      if (wins >= 50) {
        completion = completeStreak(db, req.user.id, characterId, at);
        if (completion.completed) setSelectedStmt.run(null, at, req.user.id);
      }

      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, wins, completion, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/reset', (req, res, next) => {
    try {
      const { row } = requireSelectedStreak(db, req.user.id);
      const at = nowIso();
      if (row.wins >= 1) {
        recordStreakAttempt(db, req.user.id, row.character_id, row.wins, elapsedSeconds(row, Date.parse(at)), 'reset', at);
      }
      db.prepare('DELETE FROM streak_progress WHERE streamer_id = ? AND character_id = ?').run(
        req.user.id,
        row.character_id,
      );
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/pause', (req, res, next) => {
    try {
      const { row } = requireSelectedStreak(db, req.user.id);
      const at = nowIso();
      freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, row.character_id], at);
      db.prepare(
        'UPDATE streak_progress SET paused = 1, updated_at = ? WHERE streamer_id = ? AND character_id = ?',
      ).run(at, req.user.id, row.character_id);
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/resume', (req, res, next) => {
    try {
      const { row, ts } = requireSelectedStreak(db, req.user.id);
      const at = nowIso();
      db.prepare(
        'UPDATE streak_progress SET paused = 0, updated_at = ? WHERE streamer_id = ? AND character_id = ?',
      ).run(at, req.user.id, row.character_id);
      // Only ticks again if this character is the selected one in streak mode.
      if (ts.active_mode === 'streak' && ts.selected_character_id === row.character_id) {
        startTimerIfActive(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, row.character_id], at);
      }
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/streak/start', (req, res, next) => {
    try {
      const input = z
        .object({
          character_id: characterIdSchema.optional(),
          wins: winsSchema,
          seconds: secondsSchema.default(0),
        })
        .parse(req.body);
      const at = nowIso();
      const characterId = input.character_id ?? getTrackerSession(db, req.user.id)?.selected_character_id;
      if (!characterId) throw badRequest('Select a character first', 'no_character_selected');
      requireCharacter(db, characterId);
      if (input.wins >= 50) throw badRequest('A partial start must be under 50 wins', 'invalid_wins');

      const existing = getStreak(db, req.user.id, characterId);
      const ts = getTrackerSession(db, req.user.id);
      // The tracker is active by definition — we're handling its action right now.
      const isActive = ts?.active_mode === 'streak' && ts.selected_character_id === characterId;
      const paused = existing ? existing.paused : 0;

      if (ts?.selected_character_id && ts.selected_character_id !== characterId) {
        freezeTimer(db, 'streak_progress', ['streamer_id', 'character_id'], [req.user.id, ts.selected_character_id], at);
      }

      if (existing) {
        db.prepare(
          `UPDATE streak_progress
           SET wins = ?, accumulated_seconds = ?, running_since = ?, paused = ?, zero_since = ?, milestones_reached = ?, updated_at = ?
           WHERE streamer_id = ? AND character_id = ?`,
        ).run(
          input.wins,
          input.seconds,
          isActive && !paused ? at : null,
          paused,
          input.wins === 0 ? at : null,
          milestoneBit(input.wins),
          at,
          req.user.id,
          characterId,
        );
      } else {
        db.prepare(
          `INSERT INTO streak_progress (streamer_id, character_id, wins, accumulated_seconds, running_since, paused, zero_since, milestones_reached, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          req.user.id,
          characterId,
          input.wins,
          input.seconds,
          isActive ? at : null,
          0,
          input.wins === 0 ? at : null,
          milestoneBit(input.wins),
          at,
        );
      }

      if (!ts) touchHeartbeat(db, req.user.id, at);
      setSelectedStmt.run(characterId, at, req.user.id);
      touchHeartbeat(db, req.user.id, at);
      broadcast('tracker', { streamerId: req.user.id });
      res.json({ ok: true, state: trackerState(db, req.user.id) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
