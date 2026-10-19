import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('changeme123'),
  IP_HASH_SALT: z.string().min(8).default('dev-ip-salt-change-me'),
  CLIENT_IP_HEADER: z.string().min(1).default('CF-Connecting-IP'),
  TRUST_CLOUDFLARE_HEADER: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  TRUST_PROXY: z
    .string()
    .default('auto')
    .transform((v) => {
      const val = v.trim().toLowerCase();
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
      return 'auto';
    }),
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  FETCH_YOUTUBE_TITLES: z
    .string()
    .default('true')
    .transform((v) => v !== 'false' && v !== '0'),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const c = parsed.data;
  let trustProxy = c.TRUST_PROXY;
  if (trustProxy === 'auto') {
    trustProxy = c.NODE_ENV === 'production';
  }
  return {
    env: c.NODE_ENV,
    isProduction: c.NODE_ENV === 'production',
    port: c.PORT,
    dataDir: c.DATA_DIR,
    adminUsername: c.ADMIN_USERNAME,
    adminPassword: c.ADMIN_PASSWORD,
    ipHashSalt: c.IP_HASH_SALT,
    clientIpHeader: c.CLIENT_IP_HEADER,
    trustCloudflareHeader: c.TRUST_CLOUDFLARE_HEADER,
    trustProxy,
    turnstileSiteKey: c.TURNSTILE_SITE_KEY || null,
    turnstileSecretKey: c.TURNSTILE_SECRET_KEY || null,
    // Never hit YouTube from tests: submissions there must stay offline and fast.
    fetchYoutubeTitles: c.FETCH_YOUTUBE_TITLES && c.NODE_ENV !== 'test',
    sessionCookieName: 'sut_session',
    sessionDays: 30,
  };
}
