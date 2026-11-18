---
name: ride-and-food-receipts
description: "Download last month's Uber and DoorDash receipts, on the user's Clutchbox computer, which is signed in as them. On the 2nd of every month, your agent saves last month's Uber trip and DoorDash order receipts as PDFs in one folder on your computer, with a table of dates and totals for expenses."
---

# Download last month's Uber and DoorDash receipts

Sites: uber.com, ubereats.com, doordash.com. The user syncs their sign-ins to these with the Clutchbox extension; if one isn't signed in on the computer, follow sign_in_help from computer_open.

Run the task below with the Clutchbox tools. Its settings are defaults: where the user asked for something else, do that instead.

```text
Use Clutchbox to save last month's Uber and DoorDash receipts.

Settings (change these to suit you):
- Sites: Uber trips (riders.uber.com), Uber Eats orders, DoorDash orders.
- Month: last calendar month.
- Folder: ~/Receipts/<YYYY-MM> on the computer.
- Only business: no. (Say yes to keep only trips on my Uber business profile.)

Steps:
1. Call computer_list. If I have a computer named Paperwork, open it; otherwise open a new computer with the label Paperwork.
2. On each site, open my trip or order history and find everything completed in the month. Skip cancelled trips and refunded orders, and list them separately.
3. Save each receipt as a PDF: use the site's download if it has one, otherwise open the receipt and save it with the browser's Print (Save as PDF). Never ask a site to email or resend a receipt.
4. With computer_exec, move the files from ~/Downloads into the folder, named "<date> <site> <amount> <currency>.pdf", and write summary.csv there with the columns site, date, from or restaurant, amount, tip, currency, and file.
5. Show me the table, the total per site and currency, and anything you couldn't save. If you can write files where you run, save a copy of summary.csv in your working folder as receipts-<YYYY-MM>.csv.

Only read and download: don't tip, rate, reorder, or contact support.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, skip it, name it at the end, and follow sign_in_help.
- If a page shows a bot check, don't try to solve it. Stop and tell me which site.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- The PDFs stay on your Paperwork computer, beside your SaaS invoices if you run that recipe too, until you delete it or it is replaced at your limit of computers.

## Run it on a schedule

It's meant to run on the 2nd of every month at 9:00 (cron `0 9 2 * *`). If the user wants that, set it up in your own scheduler if you have one, or tell them how to in theirs. Run it once first so the Clutchbox tools are allowed and later runs don't stop to ask.
