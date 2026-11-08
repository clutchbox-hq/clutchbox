---
title: Find subscriptions you no longer use
summary: Once a month, your agent goes through your email receipts and PayPal automatic payments, lists every subscription with what it costs you a year, and flags the ones that look unused. It cancels only the ones you name.
useCase: admin
sites: [google.com, paypal.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: On the 1st of every month at 9:00
  cron: 0 9 1 * *
---

## Prompt

```text
Use Clutchbox to find my subscriptions and the ones I may not use.

Settings (change these to suit you):
- Look back: 13 months, so yearly renewals show up.
- Where to look: my Gmail, and PayPal's automatic payments.
- Cancel: nothing. Only list them.

Steps:
1. Open a computer and go to https://mail.google.com. Tell me which account is signed in.
2. Search the look-back period for receipts and renewal notices (words like receipt, renewal, subscription, your plan, invoice, trial ending). Read each to get the service, the amount, the currency, how often it charges, the last charge date, and the account email.
3. Open PayPal (https://www.paypal.com), then its automatic payments, and add the merchants there.
4. Make one table, most expensive per year first: service, amount, how often, yearly cost, last charge, where you found it, and a "looks unused" flag with the reason. Flag a service when it has sent nothing but bills for 3 months, when it overlaps another (two music services), when a trial turned paid, or when its price went up.
5. Give the total yearly cost, and the total for the flagged ones.
6. Cancel only the services I name in a reply in this conversation, one at a time. For each, find its cancellation page, decline retention offers, and stop before the final confirmation to show me what it says (refunds, the end date, what's lost). Confirm only after I say yes to that one.

Don't unsubscribe from emails, delete anything, or change payment settings.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- Never pay, buy, cancel, delete, or accept terms unless this prompt or my reply in this conversation says to.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- Cancelling usually needs the service's own site synced too. The agent names the site if it isn't.
- Subscriptions billed through Apple or Google Play show up as their receipts in Gmail; cancel those on your phone.
