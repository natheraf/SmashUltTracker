/**
 * Cloudflare Turnstile verification. Only active when both keys are configured;
 * otherwise every token check passes (feature off by default).
 */
export async function verifyTurnstile(config, token, ip) {
  if (!config.turnstileSecretKey) return { ok: true };
  if (!token) return { ok: false, reason: 'missing_token' };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstileSecretKey,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      }),
    });
    const data = await res.json();
    return { ok: Boolean(data.success), reason: data['error-codes']?.join(',') || 'failed' };
  } catch (err) {
    console.error('[turnstile] verification error', err);
    return { ok: false, reason: 'verify_error' };
  }
}
