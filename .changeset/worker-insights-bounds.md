---
"@secondlayer/worker": patch
---

Account insights bound failed-request reads, load in parallel, evaluate four accounts at a time, and find duplicate reads in linear time. Feedback classification goes through `casTransition`.
