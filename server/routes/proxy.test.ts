import { describe, it, expect } from 'vitest';
import { isPrivateIp, isInternalHostLiteral, targetAllowedLiteral } from './proxy.js';

describe('isPrivateIp', () => {
  it('flags IPv4 loopback / private / link-local / CGNAT', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255',
                      '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4 (incl. ranges adjacent to private)', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34',
                      '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('flags IPv6 loopback / ULA / link-local and IPv4-mapped private', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
                      '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it('allows public IPv6 and IPv4-mapped public', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isInternalHostLiteral', () => {
  it('flags localhost, bare names and private IP literals', () => {
    for (const h of ['localhost', 'app.localhost', 'freshrss', 'redis',
                     '10.3.0.22', '127.0.0.1', '[::1]']) {
      expect(isInternalHostLiteral(h), h).toBe(true);
    }
  });

  it('does not flag public hostnames (resolve-check catches DNS tricks later)', () => {
    for (const h of ['example.com', 'rss.frihub.ch', '10.3.0.22.nip.io', '8.8.8.8']) {
      expect(isInternalHostLiteral(h), h).toBe(false);
    }
  });
});

describe('targetAllowedLiteral', () => {
  it('blocks obvious internal targets at the door', () => {
    for (const u of ['http://localhost/', 'http://10.3.0.22:6379/',
                     'http://freshrss/', 'http://[::1]/']) {
      expect(targetAllowedLiteral(u), u).toBe(false);
    }
  });

  it('lets public targets through the literal gate (resolve-check runs at fetch)', () => {
    for (const u of ['https://example.com/a', 'https://10.3.0.22.nip.io/']) {
      expect(targetAllowedLiteral(u), u).toBe(true);
    }
  });

  it('rejects malformed targets', () => {
    expect(targetAllowedLiteral('not a url')).toBe(false);
  });
});
