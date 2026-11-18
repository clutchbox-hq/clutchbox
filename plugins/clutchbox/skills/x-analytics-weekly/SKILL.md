---
name: x-analytics-weekly
description: "Your weekly X analytics numbers, on the user's Clutchbox computer, which is signed in as them. Every Monday, your agent reads last week's impressions, engagement, profile visits, and follows from X's account analytics, compared with the week before, with your top posts."
---

# Your weekly X analytics numbers

Sites: x.com. The user syncs their sign-ins to these with the Clutchbox extension; if one isn't signed in on the computer, follow sign_in_help from computer_open.

Run the task below with the Clutchbox tools. Its settings are defaults: where the user asked for something else, do that instead.

```text
Use Clutchbox to get last week's numbers from my X analytics.

Settings (change these to suit you):
- Week: the last 7 days, compared with the 7 days before.

Steps:
1. Open a computer and go to https://x.com/i/account_analytics. Tell me which account is signed in. If X shows analytics only with a subscription the account doesn't have, say so and stop.
2. Set the range to the week and read impressions, engagement rate, engagements, profile visits, replies, likes, reposts, bookmarks, shares, new follows, and unfollows. Do the same for the week before. X holds back the overview's detailed numbers until an account has 50 followers; if it says so, tell me, and build the totals from the posts in step 3 instead.
3. On the Content tab (https://x.com/i/account_analytics/content), list the week's 5 posts with the most impressions, with their link, impressions, engagements, and new follows if shown. Each post's own analytics page can show zeros for a few seconds before its numbers load; wait for them.
4. Make one table with each number, the week before, and the change in percent. Under it, in three sentences or fewer, say what moved most and what the top posts have in common.
5. If you can write files where you run, add the totals to x-analytics-weekly.csv in your working folder (create it with a header row if it's missing).

This is read-only: don't post, like, reply, follow, or change any setting.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Run it on a schedule

It's meant to run every Monday at 9:00 (cron `0 9 * * 1`). If the user wants that, set it up in your own scheduler if you have one, or tell them how to in theirs. Run it once first so the Clutchbox tools are allowed and later runs don't stop to ask.
