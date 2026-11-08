import { z } from 'zod';

// What a recipe file (recipes/<slug>.md) and the site results (sites/compatibility.json) may hold. The generator
// (scripts/generate.ts) checks every file against these, so a contributor learns what's wrong before review.

export const USE_CASES = [
  { key: 'social', label: 'Social' },
  { key: 'paperwork', label: 'Paperwork' },
  { key: 'admin', label: 'Admin' },
  { key: 'dashboards', label: 'Dashboards' },
] as const;
export type UseCase = (typeof USE_CASES)[number]['key'];
const useCaseKeys = USE_CASES.map(({ key }) => key) as [UseCase, ...UseCase[]];

// The agents a prompt is written for, by the kinds the web app has setup steps for.
export const AGENTS = ['claude-code', 'codex', 'chatgpt', 'claude'] as const;

// A site as the extension adds it: a lowercase domain such as x.com.
const domain = z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/, 'a lowercase domain, such as x.com');

// Every prompt must stand on its own when pasted into an agent: start it on our tools, and keep the ground rules that
// stop it typing a password or leaving the computer running.
const prompt = z
  .string()
  .refine(text => text.startsWith('Use Clutchbox to '), 'the prompt starts with "Use Clutchbox to "')
  .refine(text => text.includes('Ground rules:'), 'the prompt ends with the ground rules (see recipes/README.md)')
  .refine(text => text.includes('Never type a password'), 'the ground rules forbid typing passwords')
  .refine(text => text.includes('computer_close'), 'the ground rules end the session with computer_close');

export const recipeFrontmatter = z
  .object({
    title: z.string().min(1).max(80),
    summary: z.string().min(1).max(280),
    useCase: z.enum(useCaseKeys),
    sites: z.array(domain).min(1),
    agents: z.array(z.enum(AGENTS)).min(1),
    schedule: z
      .object({
        when: z.string().min(1).max(60),
        cron: z.string().regex(/^\S+( \S+){4}$/, 'five cron fields, such as 0 9 * * 1'),
      })
      .strict(),
  })
  .strict();

export const recipe = recipeFrontmatter.extend({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  // The file, from the repository's root.
  source: z.string(),
  prompt,
  notes: z.array(z.string().min(1)),
});
export type Recipe = z.infer<typeof recipe>;

export const SITE_STATUSES = ['works', 'partial', 'fails', 'untested'] as const;
export const siteResult = z
  .object({
    site: domain,
    name: z.string().min(1),
    status: z.enum(SITE_STATUSES),
    // The date of the check, if there was one.
    checked: z.iso.date().optional(),
    held: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict()
  .refine(result => result.status === 'untested' || result.checked, 'a checked site says when (checked)');
export type SiteResult = z.infer<typeof siteResult>;
export const compatibility = z.object({ $comment: z.string().optional(), sites: z.array(siteResult) }).strict();
