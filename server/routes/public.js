import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../errors.js';
import { characterDetail, homeSnapshot, streamerProgress, timelinePage } from '../services/home.js';

const idParam = z.coerce.number().int().positive();

/**
 * Public, session-free reads for the home page: who is live, one streamer's
 * grid, a character's history, and the community timeline.
 */
export function publicRoutes(db) {
  const router = Router();
  router.get('/home', (req, res) => {
    res.json(homeSnapshot(db));
  });

  router.get('/timeline', (req, res, next) => {
    try {
      const query = z
        .object({
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .parse(req.query ?? {});
      res.json(timelinePage(db, query));
    } catch (err) {
      next(err);
    }
  });

  router.get('/streamers/:id', (req, res, next) => {
    try {
      const progress = streamerProgress(db, idParam.parse(req.params.id));
      if (!progress) return next(notFound('No such streamer'));
      res.json(progress);
    } catch (err) {
      next(err);
    }
  });

  router.get('/streamers/:id/characters/:characterId', (req, res, next) => {
    try {
      const streamerId = idParam.parse(req.params.id);
      const characterId = idParam.parse(req.params.characterId);
      const detail = characterDetail(db, streamerId, characterId);
      if (!detail) return next(notFound('Nothing recorded for that fighter'));
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
