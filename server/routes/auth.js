import { Router } from 'express';
import { z } from 'zod';
import {
  createSession,
  destroySession,
  getUserPermissions,
  getUserRoles,
  hashPassword,
  requireUser,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
} from '../auth.js';
import { nowIso } from '../db.js';
import { badRequest, conflict, forbidden, unauthorized } from '../errors.js';
import { loginLimiter, registerLimiter } from '../middleware/rateLimits.js';
import { verifyTurnstile } from '../services/turnstile.js';
import { getClientIp } from '../services/visitorKey.js';

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);

function parseSocialUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('Invalid URL', 'invalid_url');
  }
  return { url: url.toString(), host: url.hostname.toLowerCase() };
}

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'Letters, numbers and underscores only'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  display_name: z.string().trim().min(1, 'Display name is required').max(40),
  youtube_url: z.string().trim().max(300).optional(),
  twitch_url: z.string().trim().max(300).optional(),
  turnstile_token: z.string().max(1000).optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1).max(24),
  password: z.string().min(1).max(100),
});

// Real bcrypt hash compared against when the username doesn't exist, so
// missing-user and wrong-password responses take the same time.
const TIMING_DUMMY_HASH =
  '$2b$10$L39Yl0bFafsrDd9YmFANLOxmLK0jJ4HCw26EwtvaQwrHwffNgG8OS';

const profileSchema = z.object({
  display_name: z.string().trim().min(1).max(40),
  youtube_url: z.string().trim().max(300).optional(),
  twitch_url: z.string().trim().max(300).optional(),
});

function publicUser(db, row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    youtube_url: row.youtube_url,
    twitch_url: row.twitch_url,
    status: row.status,
    roles: getUserRoles(db, row.id),
    permissions: [...getUserPermissions(db, row.id)],
  };
}

function validateSocials(youtubeUrl, twitchUrl) {
  let youtube = null;
  let twitch = null;
  if (youtubeUrl) {
    const parsed = parseSocialUrl(youtubeUrl);
    if (!parsed || !YT_HOSTS.has(parsed.host)) {
      throw badRequest('YouTube URL must be a youtube.com or youtu.be link', 'invalid_youtube');
    }
    youtube = parsed.url;
  }
  if (twitchUrl) {
    const parsed = parseSocialUrl(twitchUrl);
    if (!parsed || !TWITCH_HOSTS.has(parsed.host)) {
      throw badRequest('Twitch URL must be a twitch.tv link', 'invalid_twitch');
    }
    twitch = parsed.url;
  }
  if (!youtube && !twitch) {
    throw badRequest('Provide at least one of YouTube or Twitch', 'social_required');
  }
  return { youtube, twitch };
}

export function authRoutes(db, config) {
  const router = Router();
  const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, youtube_url, twitch_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  );
  const updateProfile = db.prepare(
    `UPDATE users SET display_name = ?, youtube_url = ?, twitch_url = ?, updated_at = ? WHERE id = ?`,
  );

  router.post('/register', registerLimiter(config), async (req, res, next) => {
    try {
      const input = registerSchema.parse(req.body);
      const { youtube, twitch } = validateSocials(input.youtube_url, input.twitch_url);

      const turnstile = await verifyTurnstile(config, input.turnstile_token, getClientIp(req, config));
      if (!turnstile.ok) throw badRequest('Captcha verification failed', 'turnstile_failed');

      if (findByUsername.get(input.username)) {
        throw conflict('Username is already taken', 'username_taken');
      }
      const info = insertUser.run(
        input.username,
        hashPassword(input.password),
        input.display_name,
        youtube,
        twitch,
        nowIso(),
        nowIso(),
      );
      res.status(201).json({
        ok: true,
        status: 'pending',
        message: 'Account created — waiting for admin approval.',
        userId: Number(info.lastInsertRowid),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', loginLimiter(config), (req, res, next) => {
    try {
      const input = loginSchema.parse(req.body);
      const row = findByUsername.get(input.username);
      // Compare against a dummy hash when the user is missing to keep timing uniform.
      const valid = row
        ? verifyPassword(input.password, row.password_hash)
        : verifyPassword(input.password, TIMING_DUMMY_HASH);
      if (!row || !valid) throw unauthorized('Invalid username or password');
      if (row.status === 'rejected') throw forbidden('This registration was rejected.');
      if (row.status === 'suspended') throw forbidden('This account is suspended.');

      const token = createSession(db, row.id, { sessionDays: config.sessionDays });
      setSessionCookie(res, token, config);
      res.json({ ok: true, user: publicUser(db, row) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', (req, res, next) => {
    try {
      if (req.session) destroySession(db, req.session.token);
      clearSessionCookie(res, config);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: row ? publicUser(db, row) : null });
  });

  router.patch('/me', requireUser, (req, res, next) => {
    try {
      const input = profileSchema.parse(req.body);
      const current = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      const { youtube, twitch } = validateSocials(
        input.youtube_url ?? current.youtube_url ?? '',
        input.twitch_url ?? current.twitch_url ?? '',
      );
      updateProfile.run(input.display_name, youtube, twitch, nowIso(), req.user.id);
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      res.json({ ok: true, user: publicUser(db, row) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
