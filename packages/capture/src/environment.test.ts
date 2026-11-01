import { describe, expect, it } from 'vitest';
import { environmentQuery, MAX_LANGUAGES, parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('keeps a valid zone and valid tags in order, once each', () => {
    expect(parseEnvironment({ timeZone: 'America/Los_Angeles', languages: 'de-DE,de,en-US,de,zh-Hant-TW' })).toEqual({
      timeZone: 'America/Los_Angeles',
      languages: ['de-DE', 'de', 'en-US', 'zh-Hant-TW'],
    });
  });
  it('leaves out what could reach a path or a shell', () => {
    expect(parseEnvironment({ timeZone: '../etc/passwd', languages: 'en;q=0.9,$(id),en_US,' })).toEqual({});
    expect(parseEnvironment({ timeZone: null, languages: null })).toEqual({});
  });
  it('caps the languages', () => {
    const many = Array.from({ length: 20 }, (_, index) => `x${String.fromCharCode(97 + index)}`).join(',');
    expect(parseEnvironment({ languages: many }).languages).toHaveLength(MAX_LANGUAGES);
  });
});

describe('environmentQuery', () => {
  it('round-trips through the query string', () => {
    const query = new URLSearchParams(environmentQuery('Europe/Berlin', ['de-DE', 'en']));
    expect(parseEnvironment({ timeZone: query.get('time_zone'), languages: query.get('languages') })).toEqual({
      timeZone: 'Europe/Berlin',
      languages: ['de-DE', 'en'],
    });
    expect(environmentQuery(undefined, [])).toBe('');
  });
});

describe('user agent and client hints', () => {
  const hints = {
    platform: 'macOS',
    platformVersion: '15.6.0',
    architecture: 'arm',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
    brands: [{ brand: 'Google Chrome', version: '156' }],
    fullVersionList: [{ brand: 'Google Chrome', version: '156.0.8078.4' }],
  };
  it('round-trips the hints, keeping only the known fields', () => {
    const query = new URLSearchParams(environmentQuery(undefined, [], { ...hints, uaFullVersion: '156', extra: 'x' }));
    expect(parseEnvironment({ userAgentData: query.get('ua_data') })).toEqual({ userAgentData: hints });
  });
  it('leaves out hints that are malformed, oversized, or not JSON, and a user agent that is not printable', () => {
    expect(environmentQuery(undefined, [], { platform: 1 })).toBe('');
    expect(parseEnvironment({ userAgentData: '{' })).toEqual({});
    expect(parseEnvironment({ userAgentData: JSON.stringify({ platform: 'x'.repeat(33) }) })).toEqual({});
    const many = { platform: 'macOS', fullVersionList: Array.from({ length: 11 }, () => hints.fullVersionList[0]) };
    expect(parseEnvironment({ userAgentData: JSON.stringify(many) })).toEqual({});
    expect(parseEnvironment({ userAgentData: JSON.stringify({ platform: 'macOS', model: ' '.repeat(3000) }) })).toEqual(
      {},
    );
    expect(parseEnvironment({ userAgent: 'Mozilla/5.0\n(evil)' })).toEqual({});
    expect(parseEnvironment({ userAgent: 'M'.repeat(513) })).toEqual({});
    expect(parseEnvironment({ userAgent: 'Mozilla/5.0 (Macintosh)' })).toEqual({
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });
  });
});
