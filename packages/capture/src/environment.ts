import { z } from 'zod';

// What a browser tells sites about itself beyond its cookies: its time zone and languages, which its profile on a
// computer copies so sites see the same person, and its user agent and client hints, which are kept but not applied.
// The extension sends them with its settings fetch (GET /api/v1/sync), as query parameters: a custom header would need
// a CORS preflight that servers from before this refuse, and a server that doesn't know the parameters ignores them.
// The user agent string needs no parameter: it is that request's own User-Agent header.

// An IANA zone name's characters only: it becomes a path on the computer, so no dots and no `..`.
export const timeZonePattern = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/;
// A BCP 47 language tag as Chrome lists them (en-US, zh-Hant-TW): letters, digits, and hyphens only, since it reaches
// a shell on the computer.
export const languageTagPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
export const MAX_LANGUAGES = 10;
// A user agent string: printable ASCII, as long as browsers send them with room to spare.
export const MAX_USER_AGENT = 512;
const userAgentPattern = /^[\x20-\x7e]{1,512}$/;
export const environmentParams = { timeZone: 'time_zone', languages: 'languages', userAgentData: 'ua_data' } as const;
// The high-entropy client hints the extension asks for (navigator.userAgentData.getHighEntropyValues).
export const userAgentHints = [
  'platform',
  'platformVersion',
  'architecture',
  'bitness',
  'model',
  'fullVersionList',
  'wow64',
] as const;
const hint = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^[\x20-\x7e]*$/);
// What getHighEntropyValues returns for userAgentHints, keeping only those fields, each capped. `mobile` and `brands`
// come with every answer.
export const userAgentDataSchema = z.object({
  platform: hint(32),
  platformVersion: hint(32).optional(),
  architecture: hint(16).optional(),
  bitness: hint(8).optional(),
  model: hint(64).optional(),
  mobile: z.boolean().optional(),
  wow64: z.boolean().optional(),
  brands: z
    .array(z.object({ brand: hint(64), version: hint(32) }))
    .max(10)
    .optional(),
  fullVersionList: z
    .array(z.object({ brand: hint(64), version: hint(32) }))
    .max(10)
    .optional(),
});
export type UserAgentData = z.infer<typeof userAgentDataSchema>;
// The JSON of the most hints a parameter carries; anything longer is left out.
export const MAX_USER_AGENT_DATA = 2_000;

export interface BrowserEnvironment {
  timeZone?: string;
  // In the browser's order of preference, at most MAX_LANGUAGES.
  languages?: string[];
  userAgent?: string;
  userAgentData?: UserAgentData;
}
function parseUserAgentData(json: string | null | undefined) {
  if (!json || json.length > MAX_USER_AGENT_DATA) return undefined;
  try {
    return userAgentDataSchema.safeParse(JSON.parse(json)).data;
  } catch {
    return undefined;
  }
}
// Keeps what is valid: a zone by its pattern, each valid tag once, in order, a printable user agent, and hints that
// parse. An invalid or empty part is left out.
export function parseEnvironment(input: {
  timeZone?: string | null | undefined;
  languages?: string | null | undefined;
  userAgent?: string | null | undefined;
  userAgentData?: string | null | undefined;
}) {
  const environment: BrowserEnvironment = {};
  if (input.timeZone && timeZonePattern.test(input.timeZone)) environment.timeZone = input.timeZone;
  const languages = [...new Set((input.languages ?? '').split(',').filter(tag => languageTagPattern.test(tag)))].slice(
    0,
    MAX_LANGUAGES,
  );
  if (languages.length) environment.languages = languages;
  if (input.userAgent && userAgentPattern.test(input.userAgent)) environment.userAgent = input.userAgent;
  const userAgentData = parseUserAgentData(input.userAgentData);
  if (userAgentData) environment.userAgentData = userAgentData;
  return environment;
}
// The query string the extension appends; empty when nothing is valid.
export function environmentQuery(
  timeZone: string | undefined,
  languages: readonly string[],
  userAgentData?: unknown,
): string {
  const json =
    userAgentData === undefined ? undefined : JSON.stringify(userAgentDataSchema.safeParse(userAgentData).data);
  const environment = parseEnvironment({ timeZone, languages: languages.join(','), userAgentData: json });
  const query = new URLSearchParams();
  if (environment.timeZone) query.set(environmentParams.timeZone, environment.timeZone);
  if (environment.languages) query.set(environmentParams.languages, environment.languages.join(','));
  if (environment.userAgentData) query.set(environmentParams.userAgentData, JSON.stringify(environment.userAgentData));
  return query.toString();
}
