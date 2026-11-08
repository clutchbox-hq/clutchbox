---
title: Your weekly App Store Connect numbers
summary: Every Monday, your agent reads last week's downloads, proceeds, conversion, and new ratings and reviews for each of your apps in App Store Connect, compared with the week before.
useCase: dashboards
sites: [apple.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every Monday at 9:00
  cron: 0 9 * * 1
---

## Prompt

```text
Use Clutchbox to get last week's numbers for my apps from App Store Connect.

Settings (change these to suit you):
- Apps: all of them.
- Week: the last 7 days with data, compared with the 7 days before.

Steps:
1. Open a computer and go to https://appstoreconnect.apple.com. Tell me which account and team are signed in. If I belong to several teams, use each one.
2. In Analytics (or Trends), read for each app: impressions, product page views, conversion rate, first-time downloads, redownloads, and proceeds, for the week and the week before. Note the last date with data.
3. In Ratings and Reviews, list the reviews from the week with their stars, country, and a one-line summary, and the average rating.
4. Make one table per app with each number, the week before, and the change in percent. Under it, in three sentences or fewer, say what moved most and anything that needs me, such as a run of 1-star reviews about the same thing.
5. If you can write files where you run, add the rows to app-store-weekly.csv in your working folder (create it with a header row if it's missing).

This is read-only: don't reply to reviews, edit metadata or prices, or submit anything.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- App Store Connect's numbers lag by a day or two, so the week ends at the last date with data.
