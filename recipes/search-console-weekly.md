---
title: Your weekly Google Search Console numbers
summary: Every Monday, your agent reads last week's clicks, impressions, and positions for your sites in Search Console, with the queries and pages that moved most and any new indexing problems.
useCase: dashboards
sites: [google.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every Monday at 9:00
  cron: 0 9 * * 1
---

## Prompt

```text
Use Clutchbox to get last week's Google Search Console numbers for my sites.

Settings (change these to suit you):
- Properties: all of them.
- Week: the last 7 days with data, compared with the 7 days before.

Steps:
1. Open a computer and go to https://search.google.com/search-console. Tell me which Google account is signed in and list its properties.
2. For each property, open Performance (Search results), set the dates to compare the week with the one before, and read total clicks, impressions, average CTR, and average position.
3. List the 5 queries and 5 pages that gained the most clicks, and the 5 of each that lost the most.
4. Open Pages (indexing) and note any reason for pages not being indexed that is new or grew this week. Note any new message in the inbox or a manual action.
5. Make one table per property with each number, the week before, and the change. Under it, in three sentences or fewer, say what moved most and what needs me.
6. If you can write files where you run, add the totals to search-console-weekly.csv in your working folder (create it with a header row if it's missing).

This is read-only: don't validate fixes, request indexing, submit sitemaps, or change users or settings.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- Search Console's data runs two or three days behind, so the week ends at the last date with data.
- Google may sign the computer out if your browser hasn't synced for a day. Keep Chrome open with the extension, or sync before the run.
