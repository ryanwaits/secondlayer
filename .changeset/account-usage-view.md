---
"@secondlayer/web": minor
---

/account/credits now shows a monthly usage view: a free-rows meter against the 10M allowance, a month switcher, a per-unit usage table (rows delivered, archive partitions, hosted webhook/memory/storage units, top-ups), and an out-of-credits banner naming `402 insufficient_credits` and the reset date. Every "last 24 hours are free" line in the account UI now reads the 10M-rows-per-month allowance instead. `/account/*` and `/login` moved under the `(www)` route group (URLs unchanged) so they get the same nav (with GitHub star count) and footer as the rest of the marketing site.
