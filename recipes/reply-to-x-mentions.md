---
title: Draft replies to your X mentions
summary: Every weekday morning, your agent reads your X mentions on your computer and drafts a reply to each one worth answering. It posts only the ones you approve.
useCase: social
sites: [x.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every weekday at 9:00
  cron: 0 9 * * 1-5
---

## Prompt

```text
Use Clutchbox to draft replies to my X mentions.

Settings (change these to suit you):
- Post the replies: no. Draft them for me to approve.
- Look back: 24 hours.
- My voice: short, plain, and specific. No hashtags, no emoji, never salesy.

Steps:
1. Open a computer and go to https://x.com/notifications/mentions. Tell me which account is signed in.
2. Read the mentions from the look-back period. Open each one to see the thread it's in.
3. Skip spam, giveaways, bots, hostile posts, and mentions I've already replied to.
4. Draft at most 10 replies, each under 280 characters, answering what the person actually said. Don't invent facts about me or my work; if a reply needs one you don't have, say what's missing instead of drafting it.
5. Show me a numbered list: each mention's author, link, and text, then your draft.
6. Post only if the setting above says yes, or I reply with the numbers to post. Post each as a reply in its own thread, one at a time, and check that it appears. Don't like, repost, follow, or send messages.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- Never pay, buy, cancel, delete, or accept terms unless this prompt or my reply in this conversation says to.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- Drafts appear in the agent's conversation (or a scheduled run's), so you approve them by replying with the numbers to post.
- X's rules limit automated posting. The recipe drafts by default and posts only what you approve, at most 10 a run.
