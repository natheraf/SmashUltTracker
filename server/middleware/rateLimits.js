import { rateLimit } from 'express-rate-limit';
import { getClientIp } from '../services/visitorKey.js';

function makeLimiter(config, { windowMs, max }) {
  if (config.env === 'test') return (req, res, next) => next();
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => getClientIp(req, config),
    message: { error: 'rate_limited', message: 'Too many requests, try again later.' },
  });
}

export const loginLimiter = (config) =>
  makeLimiter(config, { windowMs: 15 * 60_000, max: 10 });

export const registerLimiter = (config) =>
  makeLimiter(config, { windowMs: 60 * 60_000, max: 5 });

export const submitLimiter = (config) =>
  makeLimiter(config, { windowMs: 24 * 3600_000, max: 5 });

export const voteLimiter = (config) =>
  makeLimiter(config, { windowMs: 24 * 3600_000, max: 10 });
