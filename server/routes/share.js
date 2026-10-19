import { Router } from 'express';
import { homeSnapshot, primaryStreamerId, streamerProgress } from '../services/home.js';
import { renderLiveCardPng } from '../services/shareCard.js';

/**
 * Share card routes: generate an HTML preview and a 1200x630 PNG. Cached by
 * ETag (based on the home snapshot time) so embeds that re-fetch by the minute
 * don't rerender endlessly; browsers can also use Cache-Control.
 */

function setCommon(req, res) {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
}

export function shareRoutes(db) {
  const router = Router();

  router.get('/live', async (req, res, next) => {
    try {
      setCommon(req, res);
      const home = homeSnapshot(db);
      const primary = primaryStreamerId(db);
      const progress = primary ? streamerProgress(db, primary) : null;
      const png = await renderLiveCardPng({ home, progress });
      const etag = `"${png.length.toString(16)}-${Date.now().toString(16).slice(-8)}"`;
      res.set('ETag', etag);
      res.type('image/png');
      res.send(png);
    } catch (err) {
      next(err);
    }
  });

  router.get('/live.png', async (req, res, next) => {
    try {
      setCommon(req, res);
      const home = homeSnapshot(db);
      const primary = primaryStreamerId(db);
      const progress = primary ? streamerProgress(db, primary) : null;
      const png = await renderLiveCardPng({ home, progress });
      const etag = `"${png.length.toString(16)}-${Date.now().toString(16).slice(-8)}"`;
      res.set('ETag', etag);
      res.type('image/png');
      res.send(png);
    } catch (err) {
      next(err);
    }
  });

  router.get('/live.html', (req, res, next) => {
    try {
      setCommon(req, res);
      res.type('text/html');
      res.send(`<!doctype html><meta charset="utf-8"><title>SmashUltTracker Live</title><meta name="twitter:card" content="summary_large_image"><meta property="og:title" content="SmashUltTracker"><meta property="og:description" content="Live 50-win streak & Ironman."><meta property="og:image" content="${req.protocol}://${req.get('host')}/share/live.png"><body style="margin:0;background:#0b0d12;color:#e8ebf2;font-family:system-ui"><img src="/share/live.png" style="max-width:100%"></body>`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
