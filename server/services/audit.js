import { nowIso } from '../db.js';

export function logAudit(db, actorId, action, targetType = null, targetId = null, detail = null) {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(actorId, action, targetType, targetId, detail ? JSON.stringify(detail) : null, nowIso());
}
