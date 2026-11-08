---
title: Download last month's SaaS invoices
summary: On the 2nd of every month, your agent goes to each SaaS billing page you use, downloads last month's invoices into one folder on your computer, and lists them with their totals for your bookkeeping.
useCase: paperwork
sites: [github.com, notion.so]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: On the 2nd of every month at 9:00
  cron: 0 9 2 * *
---

## Prompt

```text
Use Clutchbox to download last month's invoices from my SaaS billing pages.

Settings (change these to suit you):
- Billing pages: GitHub, Notion. (Add the others you pay for, such as Vercel, Linear, Figma, or Slack. Each one must be synced in the Clutchbox extension.)
- Month: last calendar month.
- Folder: ~/Invoices/<YYYY-MM> on the computer.

Steps:
1. Call computer_list. If I have a computer named Paperwork, open it; otherwise open a new computer with the label Paperwork, and tell me to pin it in the Clutchbox Dashboard so the folder is kept.
2. For each billing page, find the account's billing or invoice history from its settings. If the site has several workspaces or organizations, check each one I pay for.
3. Download every invoice or receipt dated in the month as a PDF. If one has no download, open it and save it as a PDF with the browser's Print (Save as PDF).
4. With computer_exec, move the files from ~/Downloads into the folder, named "<date> <vendor> <amount> <currency>.pdf", and write summary.csv there with the columns vendor, date, invoice number, amount, currency, and file.
5. Show me the table, the total per currency, and any billing page with no invoice that month or that you couldn't reach. If you can write files where you run, save a copy of summary.csv in your working folder as invoices-<YYYY-MM>.csv.

Only read and download: don't pay an invoice, change a plan or payment method, or edit billing details, even if a page asks.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, skip it, name it at the end, and follow sign_in_help.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- The PDFs stay on your pinned Paperwork computer; watch it in live view to check them.
- GitHub asks you to confirm your password before some billing settings. If it does, the agent stops and names the page instead of typing it.
