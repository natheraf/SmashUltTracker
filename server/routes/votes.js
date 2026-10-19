import { Router } from 'express';
import { z } from 'zod';
import { broadcast } from '../services/bus.js';
import { primaryStreamerId } from '../services/home.js';
import { castVote, recordDailyWinners, voteStandings } from '../services/votes.js';
import { voteLimiter } from '../middleware/rateLimits.js';
import { getVisitorKey } from '../services/visitorKey.js';

/** "Who's next?" — public, one vote per visitor per UTC day. */
export function voteRoutes(db, config) {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      // Cheap and idempotent: makes sure a finished day is announced even when
      // no scheduled job ran (single-container deployments restart often).
      recordDailyWinners(db);
      res.json(
        voteStandings(db, {
          streamerId: primaryStreamerId(db),
          visitorHash: getVisitorKey(req, config),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/', voteLimiter(config), (req, res, next) => {
    try {
      const body = z
        .object({ character_id: z.coerce.number().int().positive() })
        .parse(req.body ?? {});
      castVote(db, { ipHash: getVisitorKey(req, config), characterId: body.character_id });
      broadcast('votes', { characterId: body.character_id });
      res.status(201).json(
        voteStandings(db, {
          streamerId: primaryStreamerId(db),
          visitorHash: getVisitorKey(req, config),
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  return router;
}
