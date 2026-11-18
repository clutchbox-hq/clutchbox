# Clutchbox plugin

Gives your agent a cloud computer that's already signed in as you, and the [recipes](../../recipes) as skills: replies to your X mentions, last month's invoices and receipts, subscriptions you no longer use, and weekly numbers from dashboards with no API. It works in Claude Code, Codex, Claude, and ChatGPT.

The plugin connects your agent to Clutchbox's hosted service at `https://api.clutchbox.dev/api/mcp`. You sign in once, in the browser, when your agent first connects. To choose which sites your agent's computer is signed in to, add the Clutchbox extension to Chrome from [clutchbox.dev](https://www.clutchbox.dev); nothing else leaves your browser.

## Install

Claude Code:

```text
/plugin marketplace add clutchbox-hq/clutchbox
/plugin install clutchbox@clutchbox
```

Then run `/mcp`, choose `plugin:clutchbox:clutchbox`, and authenticate.

Codex:

```sh
codex plugin marketplace add clutchbox-hq/clutchbox
codex plugin add clutchbox@clutchbox
```

Claude: in Customize, open Plugins, add a marketplace with `https://github.com/clutchbox-hq/clutchbox`, install Clutchbox, then connect it under Connectors.

Or run `npx clutchbox@latest`, which installs it in Claude Code and Codex for you.

A self-hosted server needs its own MCP URL, so add it by hand with `npx clutchbox@latest --server <url>` instead.

## Use

Ask in your own words ("save last month's invoices"), or run a skill by name, such as `/clutchbox:saas-invoices` in Claude Code. Each skill says how to run it on your agent's own schedule.

## Develop

`skills/` is generated from `recipes/` by `bun run generate-recipes`; edit the recipe, not the skill. Bump `version` in both `plugin.json` and `.claude-plugin/plugin.json` when anything here changes, so installed copies update. The icon is drawn by `scripts/brand-images.ts`.

[Privacy policy](https://www.clutchbox.dev/privacy) · Apache-2.0
