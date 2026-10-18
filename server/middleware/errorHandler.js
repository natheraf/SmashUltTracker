import { ZodError } from 'zod';
import { HttpError } from '../errors.js';

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'validation',
      message: 'Invalid input',
      details: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'bad_json', message: 'Invalid JSON body' });
  }
  console.error(`[error] ${req.method} ${req.path}`, err);
  return res.status(500).json({ error: 'internal', message: 'Internal server error' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not_found', message: 'Not found' });
}
