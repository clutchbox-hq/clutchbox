import { describe, expect, it } from 'vitest';
import { parseSetupLink, setupLinkHash, setupLinkUrl } from './setup-link.ts';

describe('setup links', () => {
  it('round-trips the sites, server, and organization', () => {
    const link = { sites: ['x.com', 'threads.com'], origin: 'https://clutchbox.dev', organization: 'org_1' };
    expect(parseSetupLink(setupLinkHash(link))).toEqual(link);
    expect(setupLinkUrl('abc', { sites: ['x.com'] })).toBe('chrome-extension://abc/setup.html#add=x.com');
  });

  it('keeps registrable domains and drops what is not a plain domain', () => {
    expect(parseSetupLink('#add=mail.google.com,X.com,x.com,https://evil.example/,1.2.3.4,localhost,a b')).toEqual({
      sites: ['google.com', 'x.com'],
    });
    const many = Array.from({ length: 30 }, (_, i) => `s${i}.com`).join(',');
    expect(parseSetupLink(`#add=${many}`)?.sites).toHaveLength(20);
  });

  it('drops an origin or organization that does not parse, but keeps the sites', () => {
    expect(parseSetupLink('#add=x.com&origin=http://example.com&organization=a/b')).toEqual({ sites: ['x.com'] });
    expect(parseSetupLink('#add=x.com&origin=agents.example.com')).toEqual({
      sites: ['x.com'],
      origin: 'https://agents.example.com',
    });
  });

  it('is no link without a site', () => {
    expect(parseSetupLink('#server')).toBeUndefined();
    expect(parseSetupLink('')).toBeUndefined();
    expect(parseSetupLink('#add=,https://x.com/')).toBeUndefined();
  });
});
