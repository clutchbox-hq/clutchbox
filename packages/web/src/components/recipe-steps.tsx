import type { Recipe } from '@clutchbox/recipes';
import type { AgentKind } from '@clutchbox/server/agents';
import type { ReactNode } from 'react';
import { agents } from './agent-steps.tsx';

// How to run a recipe on the agent's own schedule, shown in the web app's recipe gallery and on the public recipe
// pages, so both stay the same. Every recipe shares these steps; only its schedule differs. Checked against each
// vendor's scheduling docs (Claude Code's scheduled tasks, Codex's automations, ChatGPT's scheduled tasks) on
// November 8, 2026; recheck them there before editing. Whether Codex automations and ChatGPT scheduled tasks can call
// an MCP server added by hand isn't documented, and is checked before a recipe ships.
const strong = (text: string) => <strong className="font-medium text-foreground">{text}</strong>;
const code = (text: string) => <code className="text-foreground">{text}</code>;
// "Every Monday at 9:00" reads "every Monday at 9:00" mid-sentence.
const lower = (when: string) => when.charAt(0).toLowerCase() + when.slice(1);

const steps: Record<AgentKind, (schedule: Recipe['schedule'], mcpUrl: string) => ReactNode> = {
  'claude-code': ({ when, cron }, mcpUrl) => (
    <>
      <li>
        In Claude Code, run {code('/schedule')}, paste the prompt, and ask for it to run {lower(when)}.
      </li>
      <li>
        Scheduled tasks run in the cloud, even with your laptop closed, and use the connectors in your Claude account
        rather than servers added with {code('claude mcp add')}. Add Clutchbox there first: in Claude, open{' '}
        {strong('Customize')}, then {strong('Connectors')}, and add a custom connector with {code(mcpUrl)}.
      </li>
      <li>
        To run it on your own computer instead, open {strong('Scheduled')} in the Claude desktop app’s Code tab, choose{' '}
        {strong('New task')}, paste the prompt, and turn on {strong('Only on this computer')}. Once it’s created, edit
        it and set the schedule to {strong('Custom')} with {code(cron)}.
      </li>
      <li>Choose {strong('Run now')} once and allow the Clutchbox tools, so later runs don’t stop to ask.</li>
    </>
  ),
  codex: ({ when }) => (
    <>
      <li>In the Codex app, start a thread, paste the prompt, and ask Codex to run it {lower(when)}.</li>
      <li>Codex runs it while the app is open and your computer is awake, and puts what it found in your inbox.</li>
      <li>Run it once yourself first and allow the Clutchbox tools, so later runs don’t stop to ask.</li>
    </>
  ),
  chatgpt: ({ when }) => (
    <>
      <li>In a chat with the Clutchbox plugin on, paste the prompt and ask ChatGPT to run it {lower(when)}.</li>
      <li>ChatGPT saves it as a scheduled task; pause or change it under {strong('Scheduled')}.</li>
    </>
  ),
  claude: () => <li>Paste the prompt into a chat whenever you want it run.</li>,
};

// One entry per agent the recipe is written for, in the Agents page's order.
export function scheduleSteps(recipe: Pick<Recipe, 'agents' | 'schedule'>, mcpUrl: string) {
  return agents
    .filter(({ kind }) => recipe.agents.includes(kind))
    .map(({ kind, name }) => ({
      kind,
      name,
      steps: (
        <ol className="grid list-decimal gap-2 pl-5 text-sm text-foreground">{steps[kind](recipe.schedule, mcpUrl)}</ol>
      ),
    }));
}
