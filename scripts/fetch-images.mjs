// Downloads character head icons from SmashWiki into DATA_DIR/images/<slug>.png.
//
//   npm run fetch-images            # download anything missing
//   npm run fetch-images -- --force # re-download everything
//
// The MediaWiki API is queried to discover each file's real URL; nothing is
// hotlinked at runtime. A manual override (put your own <slug>.png in
// DATA_DIR/images) is never overwritten unless --force is given, and existing
// files are skipped so re-runs are cheap.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { characters, imageFileOverrides } from '../seed/characters.js';

const config = loadConfig();
const imagesDir = path.join(config.dataDir, 'images');
fs.mkdirSync(imagesDir, { recursive: true });

const API = 'https://www.ssbwiki.com/api.php';
const USER_AGENT =
  'SmashUltTracker/1.0 (fan project; contact: https://github.com/natheraf/SmashUltTracker)';
const FORCE = process.argv.includes('--force');
const REQUEST_DELAY_MS = 1100; // be polite to SmashWiki

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', ...params })) {
    url.searchParams.set(k, v);
  }
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`API gave up with HTTP ${res.status}`);
      const wait = 2000 * attempt;
      console.warn(`  HTTP ${res.status}, retrying in ${wait}ms...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`API error HTTP ${res.status}`);
    return res.json();
  }
}

function candidateTitles(char) {
  const titles = [];
  if (imageFileOverrides[char.slug]) titles.push(imageFileOverrides[char.slug]);
  const noSpace = char.name.replace(/\s+/g, '');
  titles.push(`${noSpace}HeadSSBU.png`);
  // Common alternates seen on SmashWiki.
  titles.push(`${noSpace.replace(/&/g, 'and')}HeadSSBU.png`);
  return [...new Set(titles)];
}

async function findImageUrl(char) {
  for (const title of candidateTitles(char)) {
    await sleep(REQUEST_DELAY_MS);
    const data = await api({
      action: 'query',
      titles: `File:${title}`,
      prop: 'imageinfo',
      iiprop: 'url|mime',
    });
    const pages = Object.values(data.query?.pages || {});
    const page = pages[0];
    if (page && !page.missing && page.imageinfo?.[0]) {
      return { url: page.imageinfo[0].url, mime: page.imageinfo[0].mime, via: title };
    }
  }
  // Fallback: search the File namespace.
  await sleep(REQUEST_DELAY_MS);
  const data = await api({
    action: 'query',
    list: 'search',
    srnamespace: '6',
    srsearch: `${char.name} Head SSBU`,
    srlimit: '5',
  });
  const hit = (data.query?.search || []).find((s) =>
    /HeadSSBU\.png$/i.test(s.title),
  );
  if (!hit) return null;
  await sleep(REQUEST_DELAY_MS);
  const info = await api({
    action: 'query',
    titles: hit.title,
    prop: 'imageinfo',
    iiprop: 'url|mime',
  });
  const page = Object.values(info.query?.pages || {})[0];
  if (!page?.imageinfo?.[0]) return null;
  return { url: page.imageinfo[0].url, mime: page.imageinfo[0].mime, via: hit.title };
}

async function download(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`Download gave up with HTTP ${res.status}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}

async function toPng(buffer, mime) {
  if (mime === 'image/png') return buffer;
  if (mime === 'image/svg+xml') {
    const { Resvg } = await import('@resvg/resvg-js');
    return new Resvg(buffer).render().asPng();
  }
  throw new Error(`Unsupported image type: ${mime}`);
}

async function main() {
  console.log(`Fetching ${characters.length} character images into ${imagesDir}`);
  const failed = [];
  let downloaded = 0;
  let skipped = 0;
  for (const char of characters) {
    const dest = path.join(imagesDir, `${char.slug}.png`);
    if (!FORCE && fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      process.stdout.write(`  ${char.slug} ... `);
      const found = await findImageUrl(char);
      if (!found) {
        console.log('NOT FOUND (name-tile placeholder will be used)');
        failed.push(char.slug);
        continue;
      }
      const buffer = await toPng(await download(found.url), found.mime);
      fs.writeFileSync(dest, buffer);
      console.log(`ok (${found.via})`);
      downloaded++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed.push(char.slug);
    }
  }
  console.log(
    `\nDone: ${downloaded} downloaded, ${skipped} already present, ${failed.length} failed.`,
  );
  if (failed.length) {
    console.log(`Failed slugs (add a manual override as data/images/<slug>.png):`);
    console.log(`  ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
