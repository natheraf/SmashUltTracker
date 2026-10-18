import { forbidden } from '../errors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const CSRF_HEADER = 'x-requested-with';

/**
 * CSRF defense-in-depth: SameSite=Lax cookies plus a required custom header on
 * every JSON mutation. Cross-site forms cannot set custom headers, and
 * cross-site fetches are blocked by CORS preflight.
 */
export function csrfGuard(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('application/json')) return next();
  if (req.headers[CSRF_HEADER] !== 'fetch') {
    return next(forbidden('Missing CSRF header', 'csrf'));
  }
  next();
}
