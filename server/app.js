import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { attachUser } from './auth.js';
import { projectRoot } from './db.js';
import { csrfGuard } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { trackerRoutes } from './routes/tracker.js';
import { sseRoutes } from './routes/sse.js';

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'https://www.youtube-nocookie.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use(csrfGuard);
  app.use(attachUser(db, config));

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });

  // Public roster (character-select order) — used by the tracker picker and
  // the home page's character grid.
  app.get('/api/characters', (req, res) => {
    const rows = db
      .prepare(
        'SELECT id, slug, name, series, is_dlc, is_echo FROM characters ORDER BY select_order',
      )
      .all();
    res.json({
      characters: rows.map((r) => ({ ...r, is_dlc: Boolean(r.is_dlc), is_echo: Boolean(r.is_echo) })),
    });
  });

  app.use('/api/auth', authRoutes(db, config));
  app.use('/api/admin', adminRoutes(db, config));
  app.use('/api/tracker', trackerRoutes(db));
  app.use('/api', sseRoutes());

  app.use('/api', notFoundHandler);

  // Built client (production / Docker). Vite hashes asset filenames, so they
  // can be cached forever; index.html must not be.
  const distDir = path.join(projectRoot, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), {
        immutable: true,
        maxAge: '365d',
      }),
    );
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|share\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
