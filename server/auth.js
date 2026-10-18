import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import * as cookie from 'cookie';
import { forbidden, unauthorized } from './errors.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Creates a session row and returns the raw token (only shown once). */
export function createSession(db, userId, { sessionDays = 30 } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDays * 86400_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
  ).run(hashToken(token), userId, expiresAt);
  return token;
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function getUserPermissions(db, userId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.name AS name
       FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?`,
    )
    .all(userId);
  return new Set(rows.map((r) => r.name));
}

export function getUserRoles(db, userId) {
  return db
    .prepare(
      `SELECT r.name AS name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ? ORDER BY r.name`,
    )
    .all(userId)
    .map((r) => r.name);
}

export function readSessionToken(req, config) {
  const header = req.headers.cookie;
  if (!header) return null;
  const jar = cookie.parse(header);
  return jar[config.sessionCookieName] || null;
}

export function setSessionCookie(res, token, config) {
  res.append(
    'Set-Cookie',
    cookie.serialize(config.sessionCookieName, token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionDays * 86400,
    }),
  );
}

export function clearSessionCookie(res, config) {
  res.append(
    'Set-Cookie',
    cookie.serialize(config.sessionCookieName, '', {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    }),
  );
}

/**
 * Populates req.user / req.session / req.perms when a valid session cookie is
 * present. Never rejects — use requireUser for protected routes.
 */
export function attachUser(db, config) {
  const selectSession = db.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
            u.id, u.username, u.display_name, u.youtube_url, u.twitch_url, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  );
  const touch = db.prepare(
    `UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`,
  );
  return (req, res, next) => {
    req.user = null;
    req.session = null;
    req.perms = new Set();
    const token = readSessionToken(req, config);
    if (!token) return next();
    const row = selectSession.get(hashToken(token));
    if (!row) return next();
    const now = Date.now();
    if (Date.parse(row.expires_at) <= now) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
      return next();
    }
    // Sliding expiry: refresh at most once a day per session.
    if (now - Date.parse(row.last_seen_at) > 86400_000) {
      const nowIso = new Date(now).toISOString();
      const expires = new Date(now + config.sessionDays * 86400_000).toISOString();
      touch.run(nowIso, expires, row.session_id);
    }
    req.session = { id: row.session_id, token };
    req.user = {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      youtube_url: row.youtube_url,
      twitch_url: row.twitch_url,
      status: row.status,
    };
    req.perms = getUserPermissions(db, row.id);
    return next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Only approved accounts may use the site's streamer features. */
export function requireApprovedUser(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.status !== 'approved') {
    return next(forbidden(`Account is ${req.user.status}`));
  }
  next();
}

/**
 * Permission checks read live role_permissions, so new roles need no code
 * changes — only INSERTs into roles/role_permissions.
 */
export function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!req.perms.has(perm)) return next(forbidden(`Missing permission: ${perm}`));
    next();
  };
}
