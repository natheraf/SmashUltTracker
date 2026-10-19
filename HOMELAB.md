# Running SmashUltTracker on your homelab

## Option 1: Docker Compose (recommended)

1. Clone the repo
```bash
git clone https://github.com/natheraf/SmashUltTracker.git
cd SmashUltTracker
```

2. Create `.env` from example
```bash
cp .env.example .env
```
Edit `.env` and set:
- `ADMIN_PASSWORD` (long, strong)
- `IP_HASH_SALT` (generate with `openssl rand -hex 16` or `python3 -c "import secrets; print(secrets.token_hex(16))"`)
- Optionally `TRUST_CLOUDFLARE_HEADER=true` if behind Cloudflare proxy
- Turnstile keys if you want CAPTCHA

3. Build and start
```bash
docker compose up -d --build
```

4. (Optional) Fetch character images to `/data/images`
```bash
docker compose exec smashulttracker npm run fetch-images
```
If you skip this, images fall back to name tiles.

5. Access it at http://your-server:3000
- Login as `admin` / your `ADMIN_PASSWORD`
- Go to `/admin` to approve streamers, manage users, review submissions, votes
- Streamers register from the site (pending → approve in Admin → Streamers)

Data persists in the Docker volume `smashulttracker-data` (/data).

To update: `git pull && docker compose up -d --build`

## Option 2: Node.js (bare metal)

Prereqs: Node 20.14.0+, npm 10.7+

```bash
git clone https://github.com/natheraf/SmashUltTracker.git
cd SmashUltTracker
npm ci
cp .env.example .env
# edit .env with your values
npm run fetch-images  # optional
npm run build
npm start
```

Server listens on `PORT` (default 3000). DATA_DIR defaults to `./data`.

## Reverse proxy / Cloudflare

- Put behind a reverse proxy (nginx/Caddy). If behind Cloudflare (orange cloud), set `TRUST_CLOUDFLARE_HEADER=true` and keep `CLIENT_IP_HEADER=CF-Connecting-IP`.
- Express serves API + static build + `/share` + overlay on one origin (no CORS needed). SPA fallback is configured.
- Healthcheck: `GET /api/health` returns `{ok:true}`.

## Notes

- One container, single process. Migrations run on boot. Seeds are idempotent.
- Share card at `/share/live.png` (1200×630), cached ~60s.
- Footer credits: Character art © Nintendo, images from SmashWiki.
- Default creds are only used on first boot if no admin exists.
