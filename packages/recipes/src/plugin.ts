import type { Recipe } from './schema.ts';

// The plugin (plugins/clutchbox) carries every recipe as a skill, so one install gives an agent the recipes along
// with our MCP server. Claude Code, Codex, claude.ai, and ChatGPT read the same SKILL.md: a name, a description the
// agent matches tasks against, and the instructions. The generator (scripts/generate.ts) writes these files from
// recipes/, and CI fails when they're stale.
export const pluginDir = 'plugins/clutchbox';

// "Every Monday at 9:00" reads "every Monday at 9:00" mid-sentence.
const lower = (when: string) => when.charAt(0).toLowerCase() + when.slice(1);

export function skillFile(recipe: Recipe): string {
  const description = `${recipe.title}, on the user's Clutchbox computer, which is signed in as them. ${recipe.summary}`;
  const notes = recipe.notes.length ? `\n## Notes\n\n${recipe.notes.map(note => `- ${note}`).join('\n')}\n` : '';
  return `---
name: ${recipe.slug}
description: ${JSON.stringify(description)}
---

# ${recipe.title}

Sites: ${recipe.sites.join(', ')}. The user syncs their sign-ins to these with the Clutchbox extension; if one isn't signed in on the computer, follow sign_in_help from computer_open.

Run the task below with the Clutchbox tools. Its settings are defaults: where the user asked for something else, do that instead.

\`\`\`text
${recipe.prompt}
\`\`\`
${notes}
## Run it on a schedule

It's meant to run ${lower(recipe.schedule.when)} (cron \`${recipe.schedule.cron}\`). If the user wants that, set it up in your own scheduler if you have one, or tell them how to in theirs. Run it once first so the Clutchbox tools are allowed and later runs don't stop to ask.
`;
}

// Every file the generator owns under the plugin, by path from the repository's root.
export function pluginFiles(recipes: readonly Recipe[]): Record<string, string> {
  return Object.fromEntries(
    recipes.map(recipe => [`${pluginDir}/skills/${recipe.slug}/SKILL.md`, skillFile(recipe)] as const),
  );
}
