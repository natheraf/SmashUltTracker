## Environment variables

| Name | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Server port. |
| `DATA_DIR` | `./data` | SQLite DB and `images/` go here. Persist this in production. |
| `ADMIN_USERNAME` | `admin` | Bootstraps first admin. |
| `ADMIN_PASSWORD` | `changeme123` | Change before exposing. |
| `IP_HASH_SALT` | required in prod | 16+ random chars; used for IP hashes. |
| `CLIENT_IP_HEADER` | `CF-Connecting-IP` | Use `X-Forwarded-For` only if not behind Cloudflare. |
| `TRUST_CLOUDFLARE_HEADER` | `false` | Set `true` behind trusted proxy (Cloudflare). |
| `TURNSTILE_SITE_KEY` | — | Cloudflare Turnstile (optional). |
| `TURNSTILE_SECRET_KEY` | — | Cloudflare Turnstile (optional). |
| `FETCH_YOUTUBE_TITLES` | `true` | oEmbed title lookup for submissions; forced off in `NODE_ENV=test`. |

In production, override all secrets via `.env` or the container runtime.

## Deployment

- One Node.js process (Express) serves the API, SSE, `/share`, `/api/images`, `/api/overlay` and the built Vite client. Put behind Cloudflare (orange cloud) and a reverse proxy.
- Use the provided `Dockerfile` + `docker-compose.yml` (production-ready, multi-stage, healthcheck, `/data` volume).
- `npm run fetch-images` populates `/data/images`. It finds files via SmashWiki's MediaWiki API, never hotlinks at runtime.
- Migrations run on boot (`runMigrations`). Seeds are idempotent.

## Cloudflare notes

- Enable the orange cloud so `CF-Connecting-IP` is set. Leave `TRUST_CLOUDFLARE_HEADER=true` when Cloudflare is trusted.
- Turnstile is optional; registration/submissions work without it.
- Serve over HTTPS through your reverse proxy.

## Editing the roster

`seed/characters.js` contains the full 86-slot roster (order, names, series, DLC/echo flags). Reordering `select_order` changes the grid; you can add slug overrides in `imageFileOverrides` if `fetch-images` can't find an icon.

## Share card

`/share/live.png` renders a 1200×630 card using `satori` + `@resvg/resvg-js` with Inter. It's cached for ~60s and accepts standard `ETag`/cache headers.

## Footer credits

Character art © Nintendo, images from SmashWiki. Unofficial fan project — no affiliation with Nintendo. Hashed IPs; no tracking; embeds use youtube-nocookie.com.
