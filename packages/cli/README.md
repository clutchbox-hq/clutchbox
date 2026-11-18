# clutchbox

Connects your AI agents to Clutchbox from a terminal, so they work in a browser that's already signed in as you.

```sh
npx clutchbox@latest
```

For the hosted service, it installs the [Clutchbox plugin](../../plugins/clutchbox#readme) (the MCP server and the recipes as skills) in Claude Code and Codex if they are installed; for a self-hosted server, it adds that server's MCP server to them (in every project for Claude Code). It skips an agent that's already connected, then opens setup in your browser: sign in, add the Chrome extension, and choose the sites to sync. If Chrome on this machine doesn't have the extension, it also opens the extension's Chrome Web Store page in Chrome (for the hosted service only; a self-hosted server's setup offers the build it accepts). It only reads Chrome's profile files to tell, skips the check over SSH or without a display, and keeps the usual steps whenever it can't tell. It holds no credentials. Each agent asks you to allow its own connection, as when you follow the Agents page by hand. Claude and ChatGPT on the web connect from that page.

| Option | |
| --- | --- |
| `--server <url>` | A self-hosted Clutchbox server. The default is the hosted service at `https://www.clutchbox.dev`. |
| `--agent` | For an AI agent running this for you: no questions, and the steps only you can do printed for it to pass on. Without a terminal, this is the default. |
| `-y`, `--yes` | Don't ask before changing your agents' settings. |

To have your agent do it, paste this into any agent. One with a terminal, such as Claude Code or Codex, runs the command; one without, such as Claude or ChatGPT on the web, walks you through adding the connector:

> Set up Clutchbox so you can work on a cloud computer signed in as me. If you can run terminal commands, run `npx -y clutchbox@latest --agent`. If you can't, help me add a custom connector in this app with `https://api.clutchbox.dev/api/mcp`. Then tell me the steps only I can do.

The prompt comes from `setupPrompt` in `@clutchbox/server/setup-prompt`, which the web app shows too; a test keeps this copy the same.

## Develop

`bun run build` bundles `src` into `dist/clutchbox.js`, with no runtime dependencies. The commands it runs come from `@clutchbox/server/agents`, which the Agents page shows too. A change to either needs a version bump in `package.json` (CI's `check:cli-version`), and the push to main that brings a new version publishes it to npm (`publish-cli.yml`).
