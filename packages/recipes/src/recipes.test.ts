import { describe, expect, it } from 'vitest';
import { recipes } from './index.ts';
import { loadCatalog } from './load.ts';
import { parseRecipe } from './parse.ts';

const file = (frontmatter: string, body: string) => `---\n${frontmatter}\n---\n\n${body}`;
const frontmatter = [
  'title: Do a thing',
  'summary: Your agent does a thing.',
  'useCase: social',
  'sites: [x.com, "linkedin.com"]',
  'agents: [claude-code, codex]',
  'schedule:',
  '  when: Every Monday at 9:00',
  '  cron: 0 9 * * 1',
].join('\n');
const prompt = [
  'Use Clutchbox to do a thing.',
  '',
  'Ground rules:',
  '- Never type a password or a one-time code.',
  "- When you're done, call computer_close.",
].join('\n');
const body = `## Prompt\n\n\`\`\`text\n${prompt}\n\`\`\`\n\n## Notes\n\n- One note\n  that wraps.\n- Another.\n`;

describe('parseRecipe', () => {
  it('reads the front matter, the prompt, and the notes', () => {
    expect(parseRecipe('recipes/do-a-thing.md', file(frontmatter, body))).toEqual({
      title: 'Do a thing',
      summary: 'Your agent does a thing.',
      useCase: 'social',
      sites: ['x.com', 'linkedin.com'],
      agents: ['claude-code', 'codex'],
      schedule: { when: 'Every Monday at 9:00', cron: '0 9 * * 1' },
      slug: 'do-a-thing',
      source: 'recipes/do-a-thing.md',
      prompt,
      notes: ['One note that wraps.', 'Another.'],
    });
  });

  it('names the file and the problem', () => {
    const fails = (text: string) => () => parseRecipe('recipes/bad.md', text);
    expect(fails(body)).toThrow(/recipes\/bad\.md: .*front matter/);
    expect(fails(file(frontmatter.replace('social', 'chores'), body))).toThrow(/useCase/);
    expect(fails(file(frontmatter.replace('x.com', 'https://x.com'), body))).toThrow(/lowercase domain/);
    expect(fails(file(`${frontmatter}\nextra: field`, body))).toThrow(/extra/);
    expect(fails(file(frontmatter, body.replace('## Notes', '## Steps')))).toThrow(/unknown section "Steps"/);
    expect(fails(file(frontmatter, body.replace('Use Clutchbox to', 'Please')))).toThrow(/Use Clutchbox to/);
    expect(fails(file(frontmatter, body.replace('Never type a password', 'Type')))).toThrow(/passwords/);
    expect(fails(file(frontmatter, '## Prompt\n\nNo block.\n'))).toThrow(/fenced block/);
  });
});

describe('the recipes in this repository', () => {
  it('all parse and match the generated catalog', () => {
    const catalog = loadCatalog();
    expect(catalog.recipes.length).toBeGreaterThan(0);
    expect(new Set(catalog.recipes.map(recipe => recipe.slug)).size).toBe(catalog.recipes.length);
    expect(recipes).toEqual(catalog.recipes);
  });
});
