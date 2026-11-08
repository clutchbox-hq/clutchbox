---
title: Cross-post to X, Threads, and LinkedIn
summary: Each evening, your agent takes what you posted today on one network and adapts it for the other two, keeping your words, links, and images. It publishes only what you approve.
useCase: social
sites: [x.com, threads.com, linkedin.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every day at 18:00
  cron: 0 18 * * *
---

## Prompt

```text
Use Clutchbox to cross-post my posts to X, Threads, and LinkedIn.

Settings (change these to suit you):
- Publish: no. Draft each version for me to approve.
- What to cross-post: my own posts from the last 24 hours on any of the three networks that aren't on the other two yet. (Or paste a post here, and I'll take it from there.)
- Networks: X, Threads, LinkedIn.

Steps:
1. Open a computer. On each network, open my own profile and tell me which account is signed in.
2. List my posts from the last 24 hours on each network. A post counts as already cross-posted if one with the same opening line is on the other network.
3. For each post to cross-post, adapt it for each network it's missing from: X up to 280 characters, Threads up to 500, LinkedIn up to 3,000 with a line of context if the post assumes it. Keep my wording, links, and meaning; don't add hashtags, emoji, or claims I didn't make. Replies and reposts aren't posts; skip them.
4. If the post has images, save them from the original and attach the same ones. If you can't attach them, say so instead of posting without them.
5. Show me each original and its adapted versions, numbered.
6. Publish only if the setting above says yes, or I reply with the numbers to publish. Publish each one, then open it and check it appears as written. Don't tag people, like, comment, or follow anyone.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- Never pay, buy, cancel, delete, or accept terms unless this prompt or my reply in this conversation says to.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- Sync your Threads sign-in from threads.com. If you sign in to Threads with Instagram, sync instagram.com too.
- To cross-post right after you post, run the prompt yourself with the post pasted in.
