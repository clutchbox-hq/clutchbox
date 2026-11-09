# Recipes

A recipe is a ready task for your agent on a computer signed in as you: a prompt to paste into Claude Code, Codex,
ChatGPT, or Claude, and the steps to run it on your agent's own schedule. The web app shows them where setup ends.

## Write one

Add `recipes/<slug>.md`, where the slug is the file name in lowercase words joined by hyphens:

````markdown
---
title: Draft replies to your X mentions
summary: One or two sentences on what your agent does and when, for the card and the page's description.
useCase: social
sites: [x.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every weekday at 9:00
  cron: 0 9 * * 1-5
---

## Prompt

```text
Use Clutchbox to ...
```

## Notes

- Anything the person should know first: what to sync, what the recipe won't do.
````

- **title:** the task, as people search for it, at most 80 characters.
- **useCase:** `social`, `paperwork`, `admin`, or `dashboards`.
- **sites:** the domains it needs, as you'd add them in the extension.
- **agents:** the agents the prompt is written for: `claude-code`, `codex`, `chatgpt`, `claude`.
- **schedule:** `when` in words, and the same as five cron fields.
- The front matter is plain `key: value` lines, `[a, b]` lists, and the one nested `schedule`.

The prompt:

- Starts with "Use Clutchbox to", so the agent uses its computer.
- Opens with a **Settings** block the person edits, defaulting to the safe choice: draft rather than post, stop at
  checkout, list rather than cancel.
- Asks the agent to say which account is signed in, so a wrong profile shows up early.
- Ends with the **Ground rules** from any recipe here: only the Clutchbox computer; never type a password or a
  one-time code; never pay, buy, cancel, delete, or accept terms without the prompt or a reply saying so; stop and ask
  in a scheduled run rather than guess; and `computer_close` at the end.
- Keeps files on a computer the person pins, named for the task (such as Paperwork), and says so.

Then run `bun run generate-recipes`, which checks every recipe and writes the catalog the web app imports, and
`bun run test`.

Report a site that stops working with the
[site issue form](https://github.com/clutchbox-hq/clutchbox/issues/new?template=site.yml).
