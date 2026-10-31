import { describe, expect, it } from 'vitest';
import { localeQuery, MAX_LANGUAGES, parseLocale } from './locale';

describe('parseLocale', () => {
  it('keeps a valid zone and valid tags in order, once each', () => {
    expect(parseLocale({ timeZone: 'America/Los_Angeles', languages: 'de-DE,de,en-US,de,zh-Hant-TW' })).toEqual({
      timeZone: 'America/Los_Angeles',
      languages: ['de-DE', 'de', 'en-US', 'zh-Hant-TW'],
    });
  });
  it('leaves out what could reach a path or a shell', () => {
    expect(parseLocale({ timeZone: '../etc/passwd', languages: 'en;q=0.9,$(id),en_US,' })).toEqual({});
    expect(parseLocale({ timeZone: null, languages: null })).toEqual({});
  });
  it('caps the languages', () => {
    const many = Array.from({ length: 20 }, (_, index) => `x${String.fromCharCode(97 + index)}`).join(',');
    expect(parseLocale({ languages: many }).languages).toHaveLength(MAX_LANGUAGES);
  });
});

describe('localeQuery', () => {
  it('round-trips through the query string', () => {
    const query = new URLSearchParams(localeQuery('Europe/Berlin', ['de-DE', 'en']));
    expect(parseLocale({ timeZone: query.get('time_zone'), languages: query.get('languages') })).toEqual({
      timeZone: 'Europe/Berlin',
      languages: ['de-DE', 'en'],
    });
    expect(localeQuery(undefined, [])).toBe('');
  });
});
