/**
 * YouTube link handling for fan-submitted VODs. Everything here is best-effort:
 * a submission is still valid when the title lookup fails (no API key, offline,
 * private video), because the video id and thumbnail come from the URL alone.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'youtu.be']);

const PATH_PREFIXES = new Set(['live', 'shorts', 'embed', 'v']);

/**
 * Extracts the 11-character video id from the YouTube URL shapes people
 * actually paste: watch links, youtu.be short links, live/shorts/embed links,
 * with or without extra query parameters. Returns null for anything else.
 */
export function parseYouTubeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (!YOUTUBE_HOSTS.has(host)) return null;

  let candidate = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/').filter(Boolean)[0];
  } else if (url.pathname === '/watch') {
    candidate = url.searchParams.get('v');
  } else {
    const [prefix, id] = url.pathname.split('/').filter(Boolean);
    if (PATH_PREFIXES.has(prefix)) candidate = id;
  }

  if (!candidate || !VIDEO_ID.test(candidate)) return null;
  return {
    video_id: candidate,
    youtube_url: `https://www.youtube.com/watch?v=${candidate}`,
  };
}

/** Poster image derived from the video id — no API call needed. */
export function thumbnailFor(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Video title via YouTube's public oEmbed endpoint. Returns null on any failure
 * so a submission never fails because YouTube was slow or the video is private.
 * `fetchImpl` keeps this testable without network access.
 */
export async function fetchVideoTitle(videoId, fetchImpl = fetch) {
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;
  try {
    const res = await fetchImpl(endpoint, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    const title = typeof data?.title === 'string' ? data.title.trim() : '';
    return title ? title.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/**
 * Accepts "95", "1:35" or "1:02:03" and returns whole seconds, or null when the
 * value is not a timestamp. Empty/missing input yields null.
 */
export function parseStartTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  }
  const trimmed = String(value).trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Today's date in UTC as YYYY-MM-DD. */
export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}
