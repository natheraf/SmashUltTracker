import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission, requireUser } from '../auth.js';
import { nowIso } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { logAudit } from '../services/audit.js';
import { primaryStreamerId } from '../services/home.js';
import { getPrimaryStreamerId, setPrimaryStreamerId } from '../services/settings.js';
import { listSubmissions, reviewSubmission, submissionCounts } from '../services/submissions.js';
import { addTimelineEvent } from '../services/timeline.js';
import { recordDailyWinners, resetVotes, voteHistory } from '../services/votes.js';
import { grantRole } from '../seedData.js';

const REVIEW_PERMISSIONS = [
  'review_submissions',
  'approve_streamers',
  'manage_users',
  'manage_characters',
  'revoke_completions',
];

const reviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function adminRoutes(db, config) {
  const router = Router();
  router.use(requireUser);

  /* ---------------------------------------------------------------- users -- */

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
      if (!user) throw notFound('No such account');
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

  router.post('/streamers/:id/approve', requirePermission('approve_streamers'), review('approved'));
  router.post('/streamers/:id/reject', requirePermission('approve_streamers'), review('rejected'));

  // ---- overview ---------------------------------------------------------

  router.get('/overview', requireAnyPermission(...REVIEW_PERMISSIONS), (req, res) => {
    const counts = submissionCounts(db);
    res.json({
      counts: {
        pending_submissions: counts.pending,
        approved_submissions: counts.approved,
        rejected_submissions: counts.rejected,
        pending_streamers: db
          .prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'")
          .get().n,
        users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        completions: db.prepare('SELECT COUNT(*) AS n FROM completions').get().n,
        votes_today: db
          .prepare("SELECT COUNT(*) AS n FROM votes WHERE utc_day = strftime('%Y-%m-%d','now')")
          .get().n,
      },
      primary_streamer_id: primaryStreamerId(db),
      roles: db
        .prepare(
          `SELECT r.name, r.description, COUNT(ur.user_id) AS user_count
             FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
            GROUP BY r.id ORDER BY r.name`,
        )
        .all(),
    });
  });

  // ---- submission review ------------------------------------------------

  const submissionsQuery = z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
    streamer_id: z.coerce.number().int().positive().optional(),
    character_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  router.get('/submissions', requirePermission('review_submissions'), (req, res, next) => {
    try {
      const query = submissionsQuery.parse(req.query ?? {});
      res.json(
        listSubmissions(db, {
          status: query.status,
          streamerId: query.streamer_id ?? null,
          characterId: query.character_id ?? null,
          limit: query.limit,
          offset: query.offset,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  const decide = (action) => (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { note } = reviewSchema.parse(req.body ?? {});
      const result = reviewSubmission(db, id, {
        action,
        reviewerId: req.user.id,
        note: note ?? null,
      });
      logAudit(db, req.user.id, action === 'approve' ? 'submission_approved' : 'submission_rejected', 'vod_submission', id, {
        note,
        completion_created: Boolean(result.completion?.created),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  router.post('/submissions/:id/approve', requirePermission('review_submissions'), decide('approve'));
  router.post('/submissions/:id/reject', requirePermission('review_submissions'), decide('reject'));

  router.post('/submissions/bulk', requirePermission('review_submissions'), (req, res, next) => {
    try {
      const body = z
        .object({
          ids: z.array(z.coerce.number().int().positive()).min(1).max(100),
          action: z.enum(['approve', 'reject']),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body ?? {});

      const results = [];
      for (const id of body.ids) {
        try {
          const result = reviewSubmission(db, id, {
            action: body.action,
            reviewerId: req.user.id,
            note: body.note ?? null,
          });
          results.push({ id, status: body.action === 'approve' ? 'approved' : 'rejected' });
          if (result.completion?.created) results[results.length - 1].completion_created = true;
        } catch (err) {
          results.push({ id, error: err.code || 'error', message: err.message });
        }
      }
      const changed = results.filter((row) => !row.error).length;
      logAudit(db, req.user.id, `submission_bulk_${body.action}`, 'vod_submission', null, {
        ids: body.ids,
        changed,
      });
      res.json({ changed, results });
    } catch (err) {
      next(err);
    }
  });

  // ---- accounts, roles, primary streamer --------------------------------

  router.get('/users', requirePermission('manage_users'), (req, res, next) => {
    try {
      const query = pageQuery
        .extend({
          q: z.string().trim().max(60).optional(),
          status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(),
          role: z.string().trim().max(40).optional(),
        })
        .parse(req.query ?? {});

      const clauses = [];
      const params = [];
      if (query.q) {
        clauses.push('(u.username LIKE ? OR u.display_name LIKE ?)');
        params.push(`%${query.q}%`, `%${query.q}%`);
      }
      if (query.status) {
        clauses.push('u.status = ?');
        params.push(query.status);
      }
      if (query.role) {
        clauses.push(
          `EXISTS (SELECT 1 FROM user_roles ur2 JOIN roles r2 ON r2.id = ur2.role_id
                    WHERE ur2.user_id = u.id AND r2.name = ?)`,
        );
        params.push(query.role);
      }
      const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.youtube_url, u.twitch_url, u.status, u.created_at
             FROM users u${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.limit, query.offset);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM users u${where}`).get(...params).n;

      const rolesStmt = db.prepare(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? ORDER BY r.name`,
      );
      res.json({
        users: rows.map((row) => ({ ...row, roles: rolesStmt.all(row.id).map((r) => r.name) })),
        total,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/roles', requirePermission('manage_users'), (req, res) => {
    res.json({
      roles: db
        .prepare(
          `SELECT r.name, r.description,
                  (SELECT GROUP_CONCAT(p.name, ',')
                     FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                    WHERE rp.role_id = r.id ORDER BY p.name) AS permissions
             FROM roles r ORDER BY r.name`,
        )
        .all()
        .map((row) => ({ ...row, permissions: row.permissions ? row.permissions.split(',') : [] })),
    });
  });

  router.post('/users/:id/status', requirePermission('manage_users'), (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { status, note } = pageQuery
        .omit({ limit: true, offset: true })
        .extend({
          status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body ?? {});
      if (id === req.user.id) throw badRequest('You cannot change your own status', 'self');
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!user) throw notFound('No such account');

      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
      if (status === 'approved') grantRole(db, user.username, 'streamer');
      logAudit(db, req.user.id, 'user_status_changed', 'user', id, { from: user.status, to: status, note });
      res.json({ ok: true, status });
    } catch (err) {
      next(err);
    }
  });

  router.post('/users/:id/roles', requirePermission('manage_users'), (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { role, action } = z
        .object({ role: z.string().trim().min(1).max(40), action: z.enum(['grant', 'revoke']) })
        .parse(req.body ?? {});

      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!row) throw notFound('No such account');
      const roleRow = db.prepare('SELECT * FROM roles WHERE name = ?').get(role);
      if (!roleRow) throw notFound('No such role');

      if (action === 'grant') {
        grantRole(db, row.username, role, req.user.id);
      } else {
        if (id === req.user.id) throw badRequest('You cannot remove your own roles', 'self');
        db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(id, roleRow.id);
        if (role === 'streamer' && getPrimaryStreamerId(db) === id) {
          // The primary streamer must stay a streamer.
          grantRole(db, row.username, 'streamer', req.user.id);
          throw badRequest('That account is the primary streamer', 'primary_streamer');
        }
      }
      logAudit(db, req.user.id, `role_${action}`, 'user', id, { role });
      res.json({ ok: true, roles: db.prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?').all(id).map((r) => r.name) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/settings/primary-streamer', requirePermission('manage_users'), (req, res, next) => {
    try {
      const { user_id: userId } = z
        .object({ user_id: z.coerce.number().int().positive().nullable() })
        .parse(req.body ?? {});
      if (userId === null) {
        setPrimaryStreamerId(db, null);
      } else {
        const row = db
          .prepare(
            `SELECT u.id FROM users u
              JOIN user_roles ur ON ur.user_id = u.id
              JOIN roles r ON r.id = ur.role_id AND r.name = 'streamer'
             WHERE u.id = ? AND u.status = 'approved'`,
          )
          .get(userId);
        if (!row) throw badRequest('Pick an approved streamer', 'not_a_streamer');
        setPrimaryStreamerId(db, userId);
      }
      logAudit(db, req.user.id, 'primary_streamer_set', 'user', userId, null);
      res.json({ ok: true, primary_streamer_id: primaryStreamerId(db) });
    } catch (err) {
      next(err);
    }
  });

  // ---- completions ------------------------------------------------------

  const completionView = `
    SELECT k.id, k.streamer_id, k.character_id, k.completed_at, k.duration_seconds,
           k.attempts_count, c.slug, c.name, u.display_name AS streamer_name
      FROM completions k
      JOIN characters c ON c.id = k.character_id
      JOIN users u ON u.id = k.streamer_id`;

  router.get('/completions', requirePermission('revoke_completions'), (req, res, next) => {
    try {
      const query = pageQuery
        .extend({ streamer_id: z.coerce.number().int().positive().optional() })
        .parse(req.query ?? {});
      const where = query.streamer_id ? ' WHERE k.streamer_id = ?' : '';
      const params = query.streamer_id ? [query.streamer_id] : [];
      const rows = db
        .prepare(`${completionView}${where} ORDER BY k.completed_at DESC, k.id DESC LIMIT ? OFFSET ?`)
        .all(...params, query.limit, query.offset);
      const total = db
        .prepare(`SELECT COUNT(*) AS n FROM completions k${where}`)
        .get(...params).n;
      res.json({
        completions: rows.map((row) => ({
          id: row.id,
          streamer_id: row.streamer_id,
          streamer_name: row.streamer_name,
          character: { id: row.character_id, slug: row.slug, name: row.name },
          completed_at: row.completed_at,
          duration_seconds: row.duration_seconds,
          attempts_count: row.attempts_count,
        })),
        total,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/completions', requirePermission('revoke_completions'), (req, res, next) => {
    try {
      const body = z
        .object({
          streamer_id: z.coerce.number().int().positive(),
          character_id: z.coerce.number().int().positive(),
          completed_at: z.string().trim().max(40).optional(),
          duration_seconds: z.coerce.number().int().min(0).max(30 * 24 * 3600).default(0),
          attempts_count: z.coerce.number().int().min(1).max(9999).default(1),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body ?? {});

      const completedAt = body.completed_at ? new Date(body.completed_at) : new Date();
      if (Number.isNaN(completedAt.getTime())) {
        throw badRequest('Invalid completion date', 'invalid_completed_at');
      }
      const character = db.prepare('SELECT id FROM characters WHERE id = ?').get(body.character_id);
      if (!character) throw badRequest('Unknown character', 'unknown_character');
      const existing = db
        .prepare('SELECT id FROM completions WHERE streamer_id = ? AND character_id = ?')
        .get(body.streamer_id, body.character_id);
      if (existing) throw conflict('That fighter is already completed', 'already_completed');

      const info = db
        .prepare(
          `INSERT INTO completions (streamer_id, character_id, completed_at, duration_seconds, attempts_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          body.streamer_id,
          body.character_id,
          completedAt.toISOString(),
          body.duration_seconds,
          body.attempts_count,
          nowIso(),
        );
      const id = Number(info.lastInsertRowid);
      addTimelineEvent(db, {
        type: 'completion',
        streamerId: body.streamer_id,
        characterId: body.character_id,
        payload: {
          attempts: body.attempts_count,
          duration_seconds: body.duration_seconds,
          manual: true,
        },
      });
      logAudit(db, req.user.id, 'completion_added', 'completion', id, {
        streamer_id: body.streamer_id,
        character_id: body.character_id,
        note: body.note,
      });
      res.status(201).json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/completions/:id', requirePermission('revoke_completions'), (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const row = db.prepare('SELECT * FROM completions WHERE id = ?').get(id);
      if (!row) throw notFound('No such completion');
      db.prepare('DELETE FROM completions WHERE id = ?').run(id);
      logAudit(db, req.user.id, 'completion_revoked', 'completion', id, {
        streamer_id: row.streamer_id,
        character_id: row.character_id,
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- votes ------------------------------------------------------------

  router.get('/votes', requirePermission('manage_users'), (req, res, next) => {
    try {
      const { days } = z
        .object({ days: z.coerce.number().int().min(1).max(90).default(14) })
        .parse(req.query ?? {});
      recordDailyWinners(db);
      res.json(voteHistory(db, { days }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/votes/reset', requirePermission('manage_users'), (req, res, next) => {
    try {
      const body = z
        .object({
          day: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          character_id: z.coerce.number().int().positive().optional(),
        })
        .parse(req.body ?? {});
      const result = resetVotes(db, { day: body.day, characterId: body.character_id ?? null });
      logAudit(db, req.user.id, 'votes_reset', 'votes', null, result);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  // ---- characters -------------------------------------------------------

  router.get('/characters', requirePermission('manage_characters'), (req, res, next) => {
    try {
      res.json({
        characters: db
          .prepare(
            `SELECT id, slug, name, series, select_order, is_dlc, is_echo
               FROM characters ORDER BY select_order`,
          )
          .all(),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/characters/:id', requirePermission('manage_characters'), (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const body = z
        .object({
          name: z.string().trim().min(1).max(60).optional(),
          series: z.string().trim().max(60).optional(),
          select_order: z.coerce.number().int().min(1).max(500).optional(),
          is_dlc: z.coerce.boolean().optional(),
          is_echo: z.coerce.boolean().optional(),
        })
        .parse(req.body ?? {});

      const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
      if (!row) throw notFound('No such character');

      const next_ = {
        name: body.name ?? row.name,
        series: body.series ?? row.series,
        select_order: body.select_order ?? row.select_order,
        is_dlc: body.is_dlc === undefined ? row.is_dlc : Number(body.is_dlc),
        is_echo: body.is_echo === undefined ? row.is_echo : Number(body.is_echo),
      };
      try {
        db.prepare(
          `UPDATE characters SET name = ?, series = ?, select_order = ?, is_dlc = ?, is_echo = ?
            WHERE id = ?`,
        ).run(next_.name, next_.series, next_.select_order, next_.is_dlc, next_.is_echo, id);
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) {
          throw conflict('That select order is taken', 'select_order_taken');
        }
        throw err;
      }
      logAudit(db, req.user.id, 'character_updated', 'character', id, body);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- audit log --------------------------------------------------------

  router.get('/audit', requirePermission('manage_users'), (req, res, next) => {
    try {
      const query = pageQuery
        .extend({ action: z.string().trim().max(60).optional() })
        .parse(req.query ?? {});
      const where = query.action ? ' WHERE a.action LIKE ?' : '';
      const params = query.action ? [`%${query.action}%`] : [];
      const rows = db
        .prepare(
          `SELECT a.id, a.action, a.target_type, a.target_id, a.detail, a.created_at,
                  u.display_name AS actor_name, u.username AS actor_username
             FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
             ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, query.limit, query.offset);
      const total = db
        .prepare(`SELECT COUNT(*) AS n FROM audit_log a${where}`)
        .get(...params).n;
      res.json({
        entries: rows.map((row) => ({
          ...row,
          detail: row.detail ? JSON.parse(row.detail) : null,
        })),
        total,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
