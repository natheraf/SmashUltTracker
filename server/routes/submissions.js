import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { submitLimiter } from '../middleware/rateLimits.js';
import { logAudit } from '../services/audit.js';
import { primaryStreamerId } from '../services/home.js';
import { createSubmission } from '../services/submissions.js';
import { fetchVideoTitle } from '../services/youtube.js';
import { verifyTurnstile } from '../services/turnstile.js';
import { getClientIp, getVisitorKey } from '../services/visitorKey.js';

/**
 * Fan VOD submissions. Open to visitors — no account needed. Submissions are
 * pending until an admin reviews them, except when the submitter already holds
 * review_submissions (admins trust themselves).
 */

const schema = z.object({
  streamer_id: z.coerce.number().int().positive().optional(),
  character_id: z.coerce.number().int().positive(),
  youtube_url: z.string().trim().min(1).max(500),
  start_timestamp: z
    .union([z.string().trim().max(20), z.number().int().min(0)])
    .nullish(),
  completion_date: z.string().trim().max(10).nullish(),
  note: z.string().trim().max(500).nullish(),
  submitter_handle: z.string().trim().max(60).nullish(),
  turnstile_token: z.string().max(2048).nullish(),
});

export function submissionRoutes(db, config) {
  const router = Router();

  router.post('/', submitLimiter(config), async (req, res, next) => {
    try {
      const body = schema.parse(req.body ?? {});
      const ip = getClientIp(req, config);
      const captcha = await verifyTurnstile(config, body.turnstile_token, ip);
      if (!captcha.ok) {
        return next(
          badRequest('Captcha check failed — please try again.', 'turnstile_failed'),
        );
      }

      const streamerId = body.streamer_id ?? primaryStreamerId(db);
      if (!streamerId) return next(badRequest('No streamer to submit for yet.', 'no_streamer'));

      const autoApprove = req.perms?.has('review_submissions') === true;
      const { submission, completion } = await createSubmission(db, {
        streamerId,
        characterId: body.character_id,
        youtubeUrl: body.youtube_url,
        startTimestamp: body.start_timestamp ?? null,
        completionDate: body.completion_date ?? null,
        note: body.note || null,
        submitterHandle: body.submitter_handle || null,
        ipHash: getVisitorKey(req, config),
        autoApprove,
        reviewerId: autoApprove ? req.user.id : null,
        fetchTitle: config.fetchYoutubeTitles ? fetchVideoTitle : null,
      });

      if (autoApprove) {
        logAudit(db, req.user.id, 'submission_auto_approved', 'vod_submission', submission.id, {
          streamer_id: streamerId,
          character_id: body.character_id,
          completion_created: Boolean(completion?.created),
        });
      }

      res.status(201).json({ submission, completion });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
