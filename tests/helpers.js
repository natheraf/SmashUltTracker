import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { openDb, runMigrations } from '../server/db.js';
import { bootstrapAdmin, seedCharacters, seedRoles } from '../server/seedData.js';

/**
 * Boots a real app + fresh temp database on an ephemeral port.
 * `t` is a vitest context (or any object with .after).
 */
export async function setupTestServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sut-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    IP_HASH_SALT: 'test-salt-0123456789',
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'testadminpass1',
  });
  const db = openDb(dir);
  runMigrations(db);
  seedRoles(db);
  seedCharacters(db);
  bootstrapAdmin(db, config);
  const app = createApp({ db, config });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const cleanup = () => {
    server.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  if (typeof t.onTestFinished === 'function') t.onTestFinished(cleanup);
  else if (typeof t.after === 'function') t.after(cleanup);
  return { db, config, base, client: makeClient(base), cleanup };
}

/** fetch wrapper with a cookie jar and the CSRF header on every request. */
export function makeClient(base) {
  const jar = new Map();
  async function request(method, pathname, body, { csrf = true } = {}) {
    const headers = {};
    if (csrf) headers['x-requested-with'] = 'fetch';
    if (jar.size) {
      headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [kv] = sc.split(';');
      const idx = kv.indexOf('=');
      jar.set(kv.slice(0, idx).trim(), kv.slice(idx + 1));
    }
    let jsonBody = null;
    try {
      jsonBody = await res.json();
    } catch {
      /* non-JSON response */
    }
    return { status: res.status, body: jsonBody };
  }
  return {
    get: (p, opts) => request('GET', p, undefined, opts),
    post: (p, b, opts) => request('POST', p, b ?? {}, opts),
    patch: (p, b, opts) => request('PATCH', p, b ?? {}, opts),
    del: (p, opts) => request('DELETE', p, undefined, opts),
    jar,
  };
}

/** Registers a streamer and returns the logged-in client + user id. */
export async function registerStreamer(client, overrides = {}) {
  const res = await client.post('/api/auth/register', {
    username: 'streamer1',
    password: 'password123',
    display_name: 'Streamer One',
    twitch_url: 'https://twitch.tv/streamer1',
    ...overrides,
  });
  return res;
}

/**
 * Registers a streamer, approves them through the admin API, logs in and
 * returns a logged-in client (plus a fresh admin client for assertions).
 */
export async function approvedStreamer(ctx, username = 'nairomk') {
  await ctx.client.post('/api/auth/register', {
    username,
    password: 'password123',
    display_name: 'Nai',
    twitch_url: `https://twitch.tv/${username}`,
  });
  const id = ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  const admin = makeClient(ctx.base);
  await admin.post('/api/auth/login', { username: 'admin', password: 'testadminpass1' });
  await admin.post(`/api/admin/streamers/${id}/approve`, {});
  const client = makeClient(ctx.base);
  await client.post('/api/auth/login', { username, password: 'password123' });
  return client;
}
