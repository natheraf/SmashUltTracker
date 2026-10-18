import { Router } from 'express';
import { z } from 'zod';
import { requirePermission, requireUser } from '../auth.js';
import { nowIso } from '../db.js';
import { notFound } from '../errors.js';
import { logAudit } from '../services/audit.js';
import { addTimelineEvent } from '../services/timeline.js';
import { grantRole } from '../seedData.js';

const reviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export function adminRoutes(db, config) {
  const router = Router();
  router.use(requireUser);

  const pendingStreamers = db.prepare(
    `SELECT id, username, display_name, youtube_url, twitch_url, status, created_at
     FROM users WHERE status = 'pending' ORDER BY created_at ASC`,
  );
  const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
  const setStatus = db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?');

  router.get('/streamers', requirePermission('approve_streamers'), (req, res) => {
    res.json({ streamers: pendingStreamers.all() });
  });

  const review = (newStatus) => (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { note } = reviewSchema.parse(req.body ?? {});
      const user = getUser.get(id);
      if (!user) throw notFound('No such user');
      setStatus.run(newStatus, nowIso(), id);
      if (newStatus === 'approved') {
        grantRole(db, user.username, 'streamer');
        addTimelineEvent(db, {
          type: 'streamer_joined',
          streamerId: id,
          payload: { display_name: user.display_name },
        });
      }
      logAudit(db, req.user.id, `streamer_${newStatus}`, 'user', id, { note });
      res.json({ ok: true, status: newStatus });
    } catch (err) {
      next(err);
    }
  };

  router.post(
    '/streamers/:id/approve',
    requirePermission('approve_streamers'),
    review('approved'),
  );
  router.post(
    '/streamers/:id/reject',
    requirePermission('approve_streamers'),
    review('rejected'),
  );

  return router;
}
