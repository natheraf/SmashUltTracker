# SmashUltTracker — plan and specification

The original project specification, kept verbatim so every phase can be checked
against it. Phase commits are listed at the end.

---

Build a full-stack web app tracking nairomk's "50 win streak with every Smash Ultimate character" challenge, plus an "Ironman" mode, for multiple registered streamers. Fans submit VODs; streamers run everything from a tracker page, so the host does almost no manual work.

## Stack and deployment
- Plain JavaScript (ESM), no TypeScript. React + Vite + React Router (BrowserRouter) frontend. Node + Express backend. No state library: fetch plus an EventSource hook.
- SQLite via better-sqlite3 with plain SQL and numbered .sql migration files, no ORM.
- zod for validation, bcryptjs for passwords, express-rate-limit, helmet, satori + @resvg/resvg-js for share images, vitest for tests.
- ONE Docker container (multi-stage build): Express serves the API, SSE, share images, the overlay, and the built Vite files with an SPA fallback, all on one origin. Volume /data holds the SQLite file and character images. Include a Dockerfile, docker-compose.yml and healthcheck.
- It sits behind Cloudflare proxied DNS (orange cloud) and runs plain HTTP behind my reverse proxy.
- Env vars: PORT, DATA_DIR, ADMIN_USERNAME, ADMIN_PASSWORD, IP_HASH_SALT, CLIENT_IP_HEADER (default CF-Connecting-IP), TRUST_CLOUDFLARE_HEADER, optional TURNSTILE keys (off by default).

## Design
- Clean, modern, dark mode only (color-scheme: dark, no toggle). Plain CSS with variables: near-black background, subtle cards, one accent color, system font stack. Mobile-friendly and accessible.

## Accounts and roles
- Roles are data, not code: roles table, permissions table, role_permissions, user_roles. An account can have several roles. Seed two roles: `admin` (all permissions: review_submissions, approve_streamers, manage_users, manage_characters, revoke_completions, plus auto-approval of its own submissions) and `streamer` (use_tracker). "Trusted submitter" is the admin role. Adding a role later must need no code change beyond permission checks.
- Account status: pending | approved | rejected | suspended.
- First admin: on boot, if no admin exists, create one from ADMIN_USERNAME/ADMIN_PASSWORD (approved). Admins can grant roles to any account (e.g. make nairomk both streamer and admin) and set one streamer as "primary" (nairomk).
- Streamer registration (popup dialog): username, password, display name, YouTube URL and/or Twitch URL (at least one). Starts pending; an admin approves in /admin. Login is also a popup dialog. No password recovery for now.
- Cookie sessions (httpOnly, Secure, SameSite=Lax, stored in a sessions table). CSRF protection via SameSite plus requiring a custom header on JSON mutations. Login rate limiting.
- After login the header shows Tracker (if streamer) and Admin (if admin) links.

## Characters
- Roster is a seed file I can edit: name, slug, series, select_order, is_dlc, is_echo. Order and grid layout match the Ultimate character select screen (row lengths in a config). Each entry is one character-select slot, except the three Mii Fighters (Brawler, Swordfighter, Gunner), which are 3 entries. Pokemon Trainer, Pyra/Mythra, Rosalina & Luma, Ice Climbers, Duck Hunt, Banjo & Kazooie are one entry each. Echo fighters count as separate entries.
- Images: `npm run fetch-images` downloads character images from SmashWiki (ssbwiki.com, Super Smash Bros. Ultimate pages) once into /data/images via the MediaWiki API. Discover the right files through the API, send a polite User-Agent, rate limit, cache, and never hotlink at runtime. A name-tile placeholder is the fallback, and a manual override by slug filename must work. Footer credit: "Character art (c) Nintendo, images from SmashWiki."

## Data model (sketch)
- streak_progress (PK streamer + character): wins, accumulated_seconds, running_since, zero_since, updated_at. One row per character a streamer is currently working on.
- attempts: streamer, character, wins, duration_seconds, result (failed|completed|reset), ended_at.
- completions: UNIQUE(streamer, character), completed_at, duration_seconds, attempts_count. Keep the first completion; later ones are ignored.
- ironman_runs: streamer, status (active|failed|completed), started_at, ended_at, accumulated_seconds, running_since, zero_since. ironman_entries: run, character, draw_order, status (drawn|won|lost), imported flag.
- tracker_sessions: streamer, last_heartbeat, active_mode (streak|ironman), selected_character.
- vod_submissions: streamer, character, youtube_url, video_id, title, thumbnail, start_timestamp, optional completion_date, note, optional submitter handle, ip_hash, status (pending|approved|rejected), reviewer, review_note. Multiple approved VODs per completion are allowed.
- votes: ip_hash, character, utc_day, UNIQUE(ip_hash, utc_day).
- timeline_events and audit_log.

## Tracker rules
- 50-win mode: +1 win; a loss resets that character's streak to 0 and logs an attempt; -1 / set exact wins; reset; at 50 wins a completion is created automatically (if none exists) and the streak row clears. Streamers can track several characters at once. Switching the selected character does NOT end a streak: each character's streak is saved. Partial starts are allowed (start a character at e.g. 12/50 with optional elapsed time).
- Timers: each character streak has its own timer. It runs only while that character is selected, the tracker is active, and it isn't manually paused. Pause/resume controls. Store accumulated_seconds + running_since on the server. A background job (every 30s) finalizes timers of inactive sessions at their last heartbeat time, not at the detection time.
- Ironman: win once on every character without a single loss, in random order. "Roll next character" draws uniformly from the characters not yet won with crypto RNG on the server, no rerolls, and the pending draw persists across refreshes. Win marks it won; loss fails the run (timeline event with the count) and starts a fresh run after a confirm. Run completes when the pool is empty. Its own timer with pause/resume. Partial starts: tick the characters already won and enter an elapsed time; the draw pool is the rest.
- In progress (controls what the home page shows): the streamer's tracker sent a heartbeat in the last 5 minutes AND (the run has at least 1 win OR it has been at zero wins for less than 5 minutes). For 50-win mode this applies to the selected character; for Ironman, to the active run. Inactive runs and streaks stay saved and reappear when the tracker is active again.
- Heartbeat: the tracker page POSTs every 30s; every tracker action also counts.

## Home page
1. Header: tabs, community vote, timeline, footer.
2. Tabs: a permanent "50-Win Streaks" tab, plus one Ironman tab per streamer whose Ironman run is in progress.
3. 50-Win tab: a card per in-progress streamer (display name, YouTube/Twitch links they provided, character, wins N/50, that character's timer, live badge); grid below. Ironman tab: card with X/Y won, timer, drawn character; grid shows won characters in the current run.
4. Character-select-style grid. The 50-Win grid defaults to the primary streamer, with a dropdown to view another streamer (the card list still shows all active streamers). Completed characters are marked, the selected character of an active streamer is highlighted, and other characters with partial streaks show a small N/50 badge. Click a character for a dialog: per-character stats (attempts, best streak, wins/losses, attempts to completion), who completed it and when, and approved VODs embedded (youtube-nocookie) at their timestamps.
5. Community vote: "Who's next?" one vote per visitor per UTC day; candidates are characters the primary streamer hasn't completed; show top characters today and for the last 30 days.
6. Timeline of events (newest first, paginated): completions, Ironman started/failed/completed, streak failed at 10+ wins, milestones at 10/25/40 wins, approved VODs, daily vote winners, streamers joining. Not every win.
7. Footer: fan-project disclaimer ("not affiliated with Nintendo"), image credit, short privacy note (hashed IPs, no tracking, youtube-nocookie).

## Tracker page
- 50-win mode plus Ironman mode, driven by the panel components.
- Hotkeys and buttons for win, loss, -1, set, reset, pause/resume, partial start, roll next, Ironman win/loss/pause.
- Overlay link with copy and regenerate, heartbeat state, and the tracker stays the single source of truth for the timer.

## Overlay
- Public token URL `/overlay/<token>` (transparent, OBS browser source).
- Shows character image, wins / 50, timer, attempt, best, milestones in 50-win mode; X/Y won, timer and drawn character in Ironman.

## Share card
- `GET /share/live` HTML and `GET /share/live.png` (1200x630) rendering the select grid with the header, built with satori + resvg.

## Phases
1. Schema, migrations, seed, auth and roles, admin bootstrap, registration/approval, fetch-images script
2. Tracker backend (streaks, timers, heartbeat, in-progress logic, SSE)
3. Tracker UI and overlay for 50-win mode
4. Ironman (backend, tracker UI, overlay)
5. Home page (tabs, cards, grid, character dialog, timeline, footer, design)
6. Submissions, /admin, voting
7. Share card, hardening, Docker, README (local dev, deployment, env vars, Cloudflare notes, editing the seed)

## Commit log

- a85b6d3 Initial commit
- 8aa596f chore: project scaffold, schema, auth, roles, image fetcher (phase 1)
- 336d019 feat(tracker): streak engine, timers, heartbeat, in-progress, SSE (phase 2)
- 036d962 feat(ui): tracker UI, character grid, OBS overlay (phase 3)
- eeecb77 feat(ironman): draft runs with crypto-random draws and one-life failures (phase 4)
