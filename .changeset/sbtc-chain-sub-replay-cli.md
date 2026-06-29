---
"@secondlayer/subgraphs": minor
"@secondlayer/cli": minor
---

Chain-subscription replay now covers on-Stacks sBTC peg triggers (deposit, withdrawal create/accept/reject) over a block range; `sl subscriptions replay` warns that the Bitcoin-confirmation settlement trigger (`sbtc_withdrawal_swept_confirmed`) is forward-only and not replayable. Adds chain-subscription creation to the CLI: `sl subscriptions create <name> --url <url> --trigger '<json>'` (repeatable) or `--triggers-file <path>`.
