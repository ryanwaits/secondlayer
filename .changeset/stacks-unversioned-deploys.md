---
"@secondlayer/stacks": minor
---

Contract deploys leave the Clarity version out unless you pass `clarityVersion`, so the contract deploys at the epoch's version (Clarity 6 today, was a pinned Clarity 4). Stacks epoch 4.1 rejects every deploy that names a version; `clarityVersion` is deprecated.
