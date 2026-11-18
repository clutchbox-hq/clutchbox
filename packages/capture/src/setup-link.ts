import { z } from 'zod';
import { serverOriginOfInput } from './servers.ts';
import { siteOfHost } from './sync.ts';

// The extension's setup tab, opened from a server's web app with sites to add, such as the ones a job needs. The
// person still adds them there, with one click and Chrome's prompt, so a web page can suggest sites but never add one.
// `origin` and `organization` pick the connection; a server with none yet is offered for signing in, with the
// warning when it is unverified. Any page can open the tab, as with the OAuth redirect page.
export const setupPagePath = '/setup.html';
export interface SetupLink {
  sites: string[];
  origin?: string;
  organization?: string;
}

const siteSchema = z
  .string()
  .max(253)
  .regex(/^[a-z0-9.-]+$/)
  .refine(host => host.includes('.') && !/^[0-9.]+$/.test(host))
  .transform(siteOfHost);
const organizationSchema = z.string().regex(/^[\w-]{1,64}$/);

export function setupLinkHash({ sites, origin, organization }: SetupLink): string {
  const params = new URLSearchParams({ add: sites.join(',') });
  if (origin) params.set('origin', origin);
  if (organization) params.set('organization', organization);
  return `#${params}`;
}

export const setupLinkUrl = (extensionId: string, link: SetupLink) =>
  `chrome-extension://${extensionId}${setupPagePath}${setupLinkHash(link)}`;

// The link a setup tab was opened with, or undefined. Sites that aren't plain domains are dropped, and so are an origin
// or organization that doesn't parse, rather than the whole link.
export function parseSetupLink(hash: string): SetupLink | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const add = params.get('add');
  if (!add) return undefined;
  const sites = [
    ...new Set(
      add
        .split(',')
        .slice(0, 20)
        .flatMap(each => {
          const parsed = siteSchema.safeParse(each.trim().toLowerCase());
          return parsed.success ? [parsed.data] : [];
        }),
    ),
  ];
  if (!sites.length) return undefined;
  const origin = serverOriginOfInput(params.get('origin') ?? '');
  const organization = organizationSchema.safeParse(params.get('organization'));
  return {
    sites,
    ...(origin ? { origin } : {}),
    ...(organization.success ? { organization: organization.data } : {}),
  };
}
