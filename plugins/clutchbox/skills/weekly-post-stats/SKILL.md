---
name: weekly-post-stats
description: "Your weekly post stats from X, LinkedIn, and Threads, on the user's Clutchbox computer, which is signed in as them. Every Monday, your agent collects the numbers on each of last week's posts from X, LinkedIn, and Threads into one table, and says what your best posts had in common."
---

# Your weekly post stats from X, LinkedIn, and Threads

Sites: x.com, linkedin.com, threads.com. The user syncs their sign-ins to these with the Clutchbox extension; if one isn't signed in on the computer, follow sign_in_help from computer_open.

Run the task below with the Clutchbox tools. Its settings are defaults: where the user asked for something else, do that instead.

```text
Use Clutchbox to collect last week's stats for my posts on X, LinkedIn, and Threads.

Settings (change these to suit you):
- Week: the last 7 days, ending yesterday.
- Networks: X, LinkedIn, Threads.

Steps:
1. Open a computer. On each network, open my own profile and tell me which account is signed in.
2. List my own posts from the week (not replies or reposts). For each, read the numbers the network shows on the post or its analytics page: views or impressions, likes, replies or comments, reposts, and link clicks where shown. Leave a number blank if the site doesn't show it; never estimate one.
3. Make one table, newest first: network, date, the first 60 characters, link, and the numbers.
4. Under it, give each network's totals, the three posts with the most views or impressions, and in two or three sentences what those posts have in common.
5. If you can write files where you run, add the rows to post-stats.csv in your working folder (create it with a header row if it's missing), and compare the totals with last week's rows if they're there.

This is read-only: don't post, like, reply, follow, or change any setting.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- Claude Code and Codex keep a running post-stats.csv in the folder you schedule them in, so each week compares with the last.

## Run it on a schedule

It's meant to run every Monday at 9:00 (cron `0 9 * * 1`). If the user wants that, set it up in your own scheduler if you have one, or tell them how to in theirs. Run it once first so the Clutchbox tools are allowed and later runs don't stop to ask.
