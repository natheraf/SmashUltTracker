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
import { ironmanRoutes } from './routes/ironman.js';
import { overlayRoutes } from './routes/overlay.js';
import { publicRoutes } from './routes/public.js';
import { sseRoutes } from './routes/sse.js';
import { submissionRoutes } from './routes/submissions.js';
import { shareRoutes } from './routes/share.js';
import { voteRoutes } from './routes/votes.js';

const IMAGE_FILE = /^[a-z0-9-]+\.png$/;

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://i.ytimg.com'],
          connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
          frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
      permissionsPolicy: false,
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

  // Public client config (no secrets).
  app.get('/api/config', (req, res) => {
    res.json({
      turnstile_site_key: config.turnstileSiteKey,
      overlay_origin: null,
    });
  });

  // Character head icons, served from the data volume. The filename is checked
  // against the roster so a crafted path can never escape the images dir.
  const imagesDir = path.join(config.dataDir, 'images');
  app.get('/api/images/:file', (req, res) => {
    const file = req.params.file;
    if (!IMAGE_FILE.test(file)) return res.status(404).json({ error: 'not_found' });
    const slug = file.slice(0, -4);
    const known = db.prepare('SELECT 1 AS ok FROM characters WHERE slug = ?').get(slug);
    if (!known) return res.status(404).json({ error: 'not_found' });
    const filePath = path.join(imagesDir, file);
    if (!fs.existsSync(filePath)) {
      // Missing download — the client falls back to a name tile.
      return res.status(404).json({ error: 'image_missing', message: 'Run npm run fetch-images' });
    }
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.sendFile(filePath);
  });

  app.use('/api', publicRoutes(db));
  app.use('/api/submissions', submissionRoutes(db, config));
  app.use('/api/votes', voteRoutes(db, config));
  app.use('/share', shareRoutes(db));
  app.use('/api/auth', authRoutes(db, config));
  app.use('/api/admin', adminRoutes(db, config));
  app.use('/api/tracker', trackerRoutes(db));
  app.use('/api/tracker/ironman', ironmanRoutes(db));
  app.use('/api/overlay', overlayRoutes(db));
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
