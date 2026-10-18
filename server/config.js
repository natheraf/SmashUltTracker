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
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
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
    turnstileSiteKey: c.TURNSTILE_SITE_KEY || null,
    turnstileSecretKey: c.TURNSTILE_SECRET_KEY || null,
    sessionCookieName: 'sut_session',
    sessionDays: 30,
  };
}
