import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recipes } from '../../recipes/src/index.ts';
import { setupPrompt } from './setup-prompt.ts';

describe('setup prompt', () => {
  const setup = setupPrompt();
  const recipe = recipes.find(({ slug }) => slug === 'reply-to-x-mentions');
  if (!recipe) throw new Error('reply-to-x-mentions is missing');

  it('runs the CLI where the agent has a terminal and adds the connector where it does not', () => {
    expect(setup).toContain('run `npx -y clutchbox@latest --agent`.');
    expect(setup).toContain('add a custom connector in this app with `https://api.clutchbox.dev/api/mcp`.');
    expect(setup).toMatch(/Then tell me the steps only I can do\.$/);
  });

  it("appends a recipe's task, or gives only the task to an agent that's connected", () => {
    const withJob = setupPrompt({ job: recipe });
    expect(withJob.startsWith(`${setup}\n\nWhen you're set up, use it to draft replies to my X mentions.`)).toBe(true);
    expect(withJob).toContain('Ground rules:');
    expect(setupPrompt({ job: recipe, connected: true })).toBe(recipe.prompt);
  });

  it("appends a custom job's description", () => {
    const description = '  Check my LinkedIn messages and list the ones that need an answer. ';
    expect(setupPrompt({ job: { description } })).toBe(
      `${setup}\n\nWhen you're set up, use it for this: Check my LinkedIn messages and list the ones that need an answer.`,
    );
    expect(setupPrompt({ job: { description }, connected: true })).toBe(
      'Use Clutchbox for this: Check my LinkedIn messages and list the ones that need an answer.',
    );
  });

  it("points a self-hosted server's agents at that server", () => {
    const prompt = setupPrompt({
      server: { origin: 'https://clutchbox.example.com', mcpUrl: 'https://api.example.com/api/mcp' },
    });
    expect(prompt).toContain('`npx -y clutchbox@latest --agent --server https://clutchbox.example.com`');
    expect(prompt).toContain('with `https://api.example.com/api/mcp`.');
  });

  it("matches the CLI's README", () => {
    const readme = readFileSync(new URL('../../cli/README.md', import.meta.url), 'utf8');
    expect(readme).toContain(`> ${setup}\n`);
  });
});
