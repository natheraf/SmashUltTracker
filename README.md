# SmashUltTracker

Community tracker for nairomk's **"50 win streak with every Smash Ultimate
character"** challenge and the **Ironman** mode, for multiple registered
streamers. Fans submit VODs; streamers run everything from the tracker page.

> Unofficial fan project. Not affiliated with or endorsed by Nintendo.
> Character art (c) Nintendo, images from SmashWiki.

## Status

Built in phases — see `PLAN.md` in the repo root history. Documentation is
completed in the final phase (local dev, deployment, environment variables,
Cloudflare notes, editing the roster seed).

## Quick start (development)

```sh
npm install
npm run dev        # Express on :3000 + Vite dev server on :5173
```

The first account with the `admin` role is created on boot from
`ADMIN_USERNAME` / `ADMIN_PASSWORD` (defaults: `admin` / `changeme123`).
