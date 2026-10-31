// A browser's time zone and languages, which its profile on a computer copies so sites see the same person. The
// extension sends them as query parameters on its settings fetch (GET /api/v1/sync): a custom header would need a CORS
// preflight that servers from before this refuse, and a server that doesn't know the parameters ignores them.

// An IANA zone name's characters only: it becomes a path on the computer, so no dots and no `..`.
export const timeZonePattern = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/;
// A BCP 47 language tag as Chrome lists them (en-US, zh-Hant-TW): letters, digits, and hyphens only, since it reaches
// a shell on the computer.
export const languageTagPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
export const MAX_LANGUAGES = 10;
export const localeParams = { timeZone: 'time_zone', languages: 'languages' } as const;

export interface BrowserLocale {
  timeZone?: string;
  // In the browser's order of preference, at most MAX_LANGUAGES.
  languages?: string[];
}
// Keeps what is valid: a zone by its pattern, and each valid tag once, in order. An empty part is left out.
export function parseLocale(input: { timeZone?: string | null | undefined; languages?: string | null | undefined }) {
  const locale: BrowserLocale = {};
  if (input.timeZone && timeZonePattern.test(input.timeZone)) locale.timeZone = input.timeZone;
  const languages = [...new Set((input.languages ?? '').split(',').filter(tag => languageTagPattern.test(tag)))].slice(
    0,
    MAX_LANGUAGES,
  );
  if (languages.length) locale.languages = languages;
  return locale;
}
// The query string the extension appends; empty when nothing is valid.
export function localeQuery(timeZone: string | undefined, languages: readonly string[]): string {
  const locale = parseLocale({ timeZone, languages: languages.join(',') });
  const query = new URLSearchParams();
  if (locale.timeZone) query.set(localeParams.timeZone, locale.timeZone);
  if (locale.languages) query.set(localeParams.languages, locale.languages.join(','));
  return query.toString();
}
