---
title: Reorder your usual groceries on Instacart
summary: Every Saturday morning, your agent fills your Instacart cart with your usual order, picks close replacements for anything out of stock, and stops at checkout with the total and delivery times for you to approve.
useCase: admin
sites: [instacart.com]
agents: [claude-code, codex, chatgpt, claude]
schedule:
  when: Every Saturday at 8:00
  cron: 0 8 * * 6
---

## Prompt

```text
Use Clutchbox to reorder my usual groceries on Instacart.

Settings (change these to suit you):
- My usual order: the items I've bought in at least two of my last four orders. (Or list them here.)
- Store: the one I ordered from last.
- Budget: tell me before checkout if the total is over $150.
- Place the order: no. Stop at checkout for me to approve.

Steps:
1. Open a computer and go to https://www.instacart.com. Tell me which account is signed in and the delivery address it shows.
2. Open my past orders and work out the usual order from the setting above, with the usual quantities.
3. If the cart already has items, tell me and leave them there.
4. Add each item at the store. If one is out of stock, pick the closest replacement of the same size and type, at no more than 20% over the usual price, or leave it out; list every change.
5. Go to checkout, but don't place the order. Show me the items, the replacements, what you left out, the subtotal, fees, tip, total, and the next delivery windows.
6. Place the order only if the setting above says yes and the total is within budget, or I reply "place it". Then choose the delivery window I name, or the earliest one, and show me the confirmation.

Don't change the address, payment method, or tip, and don't add anything I don't usually buy.

Ground rules:
- Work only on the Clutchbox computer. If it says busy, wait until busy_until and try once more.
- Never type a password or a one-time code. If a site wants me to sign in, stop, tell me which site, and follow sign_in_help.
- Never pay, buy, cancel, delete, or accept terms unless this prompt or my reply in this conversation says to.
- If a page shows a bot check, don't try to solve it. Stop and tell me.
- If you need my decision and I'm not here, as in a scheduled run, stop at that step and end with the question. Don't guess.
- When you're done, call computer_close.
```

## Notes

- A scheduled run leaves the cart ready at checkout. Reply in that run's conversation, or open Instacart yourself, to place the order.
