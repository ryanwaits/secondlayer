---
"@secondlayer/subgraphs": minor
"@secondlayer/cli": minor
"@secondlayer/shared": patch
---

tip-first deploys: backfillMode "concurrent" (CLI --tip-first) goes live at chain tip immediately and backfills history via a non-destructive background op; breaking redeploys refused pre-mutation; sync integrity reports history_filling while the op runs
