import crypto from 'node:crypto';
import net from 'node:net';

/**
 * Reduces an IPv6 address to its /64 prefix so one visitor behind a rotating
 * IPv6 block counts as one identity. IPv4 is returned as-is (after stripping
 * IPv4-mapped IPv6 wrapping).
 */
export function normalizeIp(raw) {
  if (!raw) return '';
  let ip = String(raw).trim().split(',')[0].trim();
  if (ip.startsWith('"') && ip.endsWith('"')) ip = ip.slice(1, -1);
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) {
    ip = ip.slice(7);
  }
  if (!net.isIPv6(ip)) return ip.toLowerCase();

  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  let head = ip;
  let tail = '';
  const dbl = ip.indexOf('::');
  if (dbl !== -1) {
    head = ip.slice(0, dbl);
    tail = ip.slice(dbl + 2);
  }
  const headParts = head ? head.split(':') : [];
  let tailParts = [];
  if (tail) {
    if (tail.includes('.')) {
      // IPv4-embedded tail such as ::ffff:a.b.c.d
      const v4 = tail.split('.').map(Number);
      tailParts = [
        ((v4[0] << 8) | v4[1]).toString(16),
        ((v4[2] << 8) | v4[3]).toString(16),
      ];
    } else {
      tailParts = tail.split(':');
    }
  }
  const missing = 8 - (headParts.length + tailParts.length);
  const parts = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
    .slice(0, 8)
    .map((p) => parseInt(p || '0', 16).toString(16));
  return `${parts.slice(0, 4).join(':')}::/64`;
}

/**
 * The client IP. The proxy header is only trusted when explicitly enabled —
 * otherwise any client could spoof it. See README: the origin must only be
 * reachable through Cloudflare when TRUST_CLOUDFLARE_HEADER=true.
 */
export function getClientIp(req, config) {
  if (config.trustCloudflareHeader) {
    const header = req.headers[config.clientIpHeader.toLowerCase()];
    if (header) return normalizeIp(header);
  }
  return normalizeIp(req.socket.remoteAddress || req.ip || '');
}

/**
 * Stable per-visitor identity for votes and submission limits: salted hash of
 * the client IP. Isolated here so a cookie, fingerprint or OAuth identity can
 * replace it later without touching callers.
 */
export function getVisitorKey(req, config) {
  const ip = getClientIp(req, config);
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(`${config.ipHashSalt}:${ip}`).digest('hex');
}
