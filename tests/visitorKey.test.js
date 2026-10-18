import { describe, expect, it } from 'vitest';
import { getVisitorKey, normalizeIp } from '../server/services/visitorKey.js';

const config = {
  ipHashSalt: 'salt-a',
  clientIpHeader: 'CF-Connecting-IP',
  trustCloudflareHeader: true,
};

describe('IPv6 /64 reduction', () => {
  it('reduces addresses in the same /64 to the same identity', () => {
    expect(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(
      normalizeIp('2001:db8:1:2:1111:2222:3333:4444'),
    );
    expect(normalizeIp('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
  });

  it('keeps different /64 prefixes distinct', () => {
    expect(normalizeIp('2001:db8:1:2::1')).not.toBe(normalizeIp('2001:db8:1:3::1'));
  });

  it('handles compressed and full forms', () => {
    expect(normalizeIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeIp('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(
      '2001:db8:1:2::/64',
    );
  });

  it('leaves IPv4 alone and unwraps IPv4-mapped addresses', () => {
    expect(normalizeIp('192.168.1.5')).toBe('192.168.1.5');
    expect(normalizeIp('::ffff:192.168.1.5')).toBe('192.168.1.5');
  });
});

describe('getVisitorKey', () => {
  const reqWith = (headers, remote = '10.0.0.1') => ({
    headers,
    socket: { remoteAddress: remote },
    ip: remote,
  });

  it('uses the Cloudflare header only when trusted', () => {
    const trusted = getVisitorKey(
      reqWith({ 'cf-connecting-ip': '203.0.113.9' }),
      config,
    );
    const untrusted = getVisitorKey(
      reqWith({ 'cf-connecting-ip': '203.0.113.9' }),
      { ...config, trustCloudflareHeader: false },
    );
    const socket = getVisitorKey(reqWith({}, '10.0.0.1'), config);
    expect(trusted).not.toBe(untrusted);
    expect(untrusted).toBe(socket);
  });

  it('is a stable salted hash and differs per salt', () => {
    const a = getVisitorKey(reqWith({ 'cf-connecting-ip': '203.0.113.9' }), config);
    const b = getVisitorKey(reqWith({ 'cf-connecting-ip': '203.0.113.9' }), config);
    const c = getVisitorKey(reqWith({ 'cf-connecting-ip': '203.0.113.9' }), {
      ...config,
      ipHashSalt: 'salt-b',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('collapses visitors in the same IPv6 /64 to one key', () => {
    const a = getVisitorKey(
      reqWith({ 'cf-connecting-ip': '2001:db8:1:2::1' }),
      config,
    );
    const b = getVisitorKey(
      reqWith({ 'cf-connecting-ip': '2001:db8:1:2:9999::f' }),
      config,
    );
    expect(a).toBe(b);
  });
});
