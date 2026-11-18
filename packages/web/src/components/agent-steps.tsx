import {
  type AgentKind,
  agentAddCommands,
  agentPluginCommands,
  mcpServerName,
  pluginMcpUrl,
  pluginServerNames,
} from '@clutchbox/server/agents';
import { buttonVariants } from '@clutchbox/ui/components/button';
import { Input } from '@clutchbox/ui/components/input';
import type { ReactNode } from 'react';
import { CopyButton } from './copy-button.tsx';

// How to connect each agent, shown on the app's Agents page and the public setup guides, so both stay the same.
const strong = (text: string) => <strong className="font-medium text-foreground">{text}</strong>;
function Command({ label, command }: { label: string; command: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3">
      <Input readOnly aria-label={label} value={command} className="min-w-60 flex-1" />
      <CopyButton text={command} label={`Copy the ${label.toLowerCase()}`} />
    </div>
  );
}
const commandLine = (commands: string[][]) => commands.map(command => command.join(' ')).join(' && ');
// For the hosted service, the agent plugin brings the recipes as skills along with the MCP server; its URL is fixed,
// so any other server gets the plain MCP commands.
const usesPlugin = (mcpUrl: string) => mcpUrl === pluginMcpUrl;
// Steps checked against each vendor's MCP setup docs; recheck them there before editing. The tab follows the
// client_id URL the agent registers with (packages/server/src/agents.ts).
export const agents: { kind: AgentKind; name: string; steps: (mcpUrl: string) => ReactNode }[] = [
  {
    kind: 'claude-code',
    name: 'Claude Code',
    steps: mcpUrl => {
      const plugin = usesPlugin(mcpUrl);
      return (
        <ol className="grid list-decimal gap-3 pl-5 text-sm text-foreground">
          <li>
            In a terminal, run:
            <Command
              label="Claude Code command"
              command={
                plugin
                  ? commandLine(agentPluginCommands['claude-code'])
                  : agentAddCommands['claude-code'](mcpUrl).join(' ')
              }
            />
            {plugin && (
              <p className="mt-2 text-muted-foreground">It adds the Clutchbox plugin, with the recipes as skills.</p>
            )}
          </li>
          <li>
            In Claude Code, run <code className="text-foreground">/mcp</code>, choose{' '}
            {strong(plugin ? pluginServerNames['claude-code'] : mcpServerName)}, then {strong('Authenticate')}, and
            allow the connection in your browser.
          </li>
        </ol>
      );
    },
  },
  {
    kind: 'claude',
    name: 'Claude',
    steps: () => (
      <ol className="grid list-decimal gap-2 pl-5 text-sm text-foreground">
        <li>
          Open{' '}
          <a
            href="https://claude.ai/new?modal=add-custom-connector#customize/connectors/yours"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'link', className: 'inline h-auto whitespace-normal p-0' })}
          >
            Add custom connector in Claude
          </a>
          .
        </li>
        <li>Paste the URL above and add the connector.</li>
        <li>Choose {strong('Connect')} and allow the connection.</li>
      </ol>
    ),
  },
  {
    kind: 'codex',
    name: 'Codex',
    steps: mcpUrl =>
      usesPlugin(mcpUrl) ? (
        <ol className="grid list-decimal gap-3 pl-5 text-sm text-foreground">
          <li>
            In a terminal, run:
            <Command label="Codex command" command={commandLine(agentPluginCommands.codex)} />
            <p className="mt-2 text-muted-foreground">It adds the Clutchbox plugin, with the recipes as skills.</p>
          </li>
          <li>
            Sign in and allow the connection:
            <Command label="Codex sign-in command" command={`codex mcp login ${pluginServerNames.codex}`} />
          </li>
        </ol>
      ) : (
        <ol className="grid list-decimal gap-3 pl-5 text-sm text-foreground">
          <li>
            In a terminal, run:
            <Command label="Codex command" command={agentAddCommands.codex(mcpUrl).join(' ')} />
          </li>
          <li>
            Follow the browser prompt to sign in and allow the connection. If sign-in did not complete, run:
            <Command label="Codex sign-in command" command={`codex mcp login ${mcpServerName}`} />
          </li>
        </ol>
      ),
  },
  {
    kind: 'chatgpt',
    name: 'ChatGPT',
    steps: () => (
      <ol className="grid list-decimal gap-2 pl-5 text-sm text-foreground">
        <li>
          Open{' '}
          <a
            href="https://chatgpt.com/plugins"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'link', className: 'inline h-auto whitespace-normal p-0' })}
          >
            ChatGPT Plugins
          </a>
          , choose {strong('+')}, then {strong('Add custom MCP server')}.
        </li>
        <li>
          Choose {strong('OAuth')}, paste the URL above, then create and install the plugin and allow the connection.
        </li>
      </ol>
    ),
  },
];
