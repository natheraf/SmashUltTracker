import { Router } from 'express';
import { requireApprovedUser, requirePermission, requireUser } from '../auth.js';
import { nowIso } from '../db.js';
import { badRequest } from '../errors.js';
import { broadcast } from '../services/bus.js';
import { abandonRun, activeRun, createRun, drawNext, loseDraw, winDraw } from '../services/ironman.js';
import { freezeTimer, startTimerIfActive, touchHeartbeat } from '../services/timers.js';
import { trackerState } from './tracker.js';

/**
 * Ironman actions. Every response carries the fresh tracker state so the client
 * adopts it directly, exactly like the streak endpoints.
 *
 *   start     — new run, full roster laid out as the deck
 *   draw      → one random pending character (final until resolved)
 *   win       → marks the draw won; completes the run at 86/86
 *   loss      -> hardcore: the drawn character loses, the run ends failed
 *   abandon   -> streamer ends the run without a loss
 *   pause/resume -> freezes/unfreezes the run timer
 */
export function ironmanRoutes(db) {
  const router = Router();
  router.use(requireUser, requireApprovedUser, requirePermission('use_tracker'));
  // Like the streak actions, every request doubles as a heartbeat.
  router.use((req, res, next) => {
    touchHeartbeat(db, req.user.id);
    next();
  });

  function requireRun(streamerId) {
    const run = activeRun(db, streamerId);
    if (!run) throw badRequest('No active Ironman run', 'no_run');
    return run;
  }

  function respond(res, streamerId, extra = {}) {
    res.json({ ok: true, ...extra, state: trackerState(db, streamerId) });
  }

  router.post('/start', (req, res, next) => {
    try {
      const at = nowIso();
      const run = createRun(db, req.user.id, at);
      // Starting a run puts the tracker in Ironman mode for this stream.
      db.prepare('UPDATE tracker_sessions SET active_mode = ?, updated_at = ? WHERE streamer_id = ?').run(
        'ironman',
        at,
        req.user.id,
      );
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, { run_id: run.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/draw', (req, res, next) => {
    try {
      const run = requireRun(req.user.id);
      const entry = drawNext(db, run.id);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, {
        character: { slug: entry.slug, name: entry.name, character_id: entry.character_id },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/win', (req, res, next) => {
    try {
      const at = nowIso();
      const run = requireRun(req.user.id);
      const result = winDraw(db, run, at);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, {
        completed: result.completed,
        character: { slug: result.entry.slug, name: result.entry.name },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/loss', (req, res, next) => {
    try {
      const at = nowIso();
      const run = requireRun(req.user.id);
      const failed = loseDraw(db, run, at);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, { failed_run_id: failed.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/abandon', (req, res, next) => {
    try {
      const at = nowIso();
      const run = requireRun(req.user.id);
      abandonRun(db, run, at);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, {});
    } catch (err) {
      next(err);
    }
  });

  router.post('/pause', (req, res, next) => {
    try {
      const at = nowIso();
      const run = requireRun(req.user.id);
      freezeTimer(db, 'ironman_runs', ['id'], [run.id], at);
      db.prepare('UPDATE ironman_runs SET paused = 1 WHERE id = ?').run(run.id);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, {});
    } catch (err) {
      next(err);
    }
  });

  router.post('/resume', (req, res, next) => {
    try {
      const at = nowIso();
      const run = requireRun(req.user.id);
      db.prepare('UPDATE ironman_runs SET paused = 0 WHERE id = ?').run(run.id);
      startTimerIfActive(db, 'ironman_runs', ['id'], [run.id], at);
      broadcast('ironman', { streamerId: req.user.id });
      respond(res, req.user.id, {});
    } catch (err) {
      next(err);
    }
  });

  return router;
}
