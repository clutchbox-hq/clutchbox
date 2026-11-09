import { readFileSync } from 'node:fs';
import { type CapturedCookie, siteOfCookie } from '@clutchbox/capture';
import { z } from 'zod';

// What a deployment knows about how a site treats a copied sign-in (hooks.ts, siteRules). `keepOut` names cookies never
// applied to a computer, for a site that rejects its session token arriving from another browser but issues the computer
// its own from the rest, such as a remember-me cookie. Captures keep them, and so do the API and SDK; only computers
// go without.
const siteRule = z
  .object({
    site: z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/, 'a lowercase domain, such as example.com'),
    keepOut: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type SiteRule = z.infer<typeof siteRule>;
export const siteRules = z.array(siteRule).superRefine((rules, context) => {
  const sites = rules.map(rule => rule.site);
  for (const site of sites.filter((site, index) => sites.indexOf(site) !== index))
    context.addIssue({ code: 'custom', message: `${site} is listed twice` });
});

// A capture's cookies as a computer gets them. Apply takes this before diffing and sealing its baseline, so a kept-out
// cookie is never set, and the computer's own copy is never changed or removed.
export function withoutKeptOut(cookies: CapturedCookie[], rules: readonly SiteRule[]): CapturedCookie[] {
  if (!rules.length) return cookies;
  const keptOut = new Map(rules.map(rule => [rule.site, new Set(rule.keepOut)]));
  return cookies.filter(cookie => !keptOut.get(siteOfCookie(cookie))?.has(cookie.name));
}

// The rules in a self-hosted deployment's file (SITE_RULES_PATH), a JSON array of rules; none without one. A file that
// can't be read or isn't valid throws: without its rules, computers would get the cookies it means to keep out.
export function readSiteRules(file: string | undefined): SiteRule[] {
  if (!file) return [];
  try {
    return siteRules.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    const reason = error instanceof z.ZodError ? z.prettifyError(error) : 'it is missing, unreadable, or not JSON';
    throw new Error(`SITE_RULES_PATH: ${file} is not a valid site rules file: ${reason}`);
  }
}
