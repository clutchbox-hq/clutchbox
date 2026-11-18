import { pluginMcpUrl } from './agents.ts';

// The prompt that has any agent set itself up with Clutchbox: the homepage, setup's agent step, and the CLI's README
// give the same one. It's self-contained, not "fetch this page and follow it", so the user sees what they approve and
// agents don't treat it as an injection. An agent with a terminal runs `npx clutchbox`; one without walks the user
// through adding the connector. When the agent plugin ships, only the install line changes, here.

// The hosted service, the CLI's default --server.
export const hostedServer = { origin: 'https://www.clutchbox.dev', mcpUrl: pluginMcpUrl };

// The first job: a recipe (its prompt starts "Use Clutchbox to "), or one the user described in their own words.
export type SetupJob = { prompt: string } | { description: string };

const recipeLead = /^Use Clutchbox to /;

export function setupPrompt({
  job,
  connected = false,
  server = hostedServer,
}: {
  job?: SetupJob;
  // An agent is already connected, so it needs only the job.
  connected?: boolean;
  server?: { origin: string; mcpUrl: string };
} = {}): string {
  const flag = server.origin === hostedServer.origin ? '' : ` --server ${server.origin}`;
  const setup = `Set up Clutchbox so you can work on a cloud computer signed in as me. If you can run terminal commands, run \`npx -y clutchbox@latest --agent${flag}\`. If you can't, help me add a custom connector in this app with \`${server.mcpUrl}\`. Then tell me the steps only I can do.`;
  if (!job) return setup;
  if ('prompt' in job)
    return connected ? job.prompt : `${setup}\n\nWhen you're set up, use it to ${job.prompt.replace(recipeLead, '')}`;
  const description = job.description.trim();
  return connected
    ? `Use Clutchbox for this: ${description}`
    : `${setup}\n\nWhen you're set up, use it for this: ${description}`;
}
