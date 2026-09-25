---
"@secondlayer/cli": patch
---

`secondlayer webhooks doctor` output is unchanged, but its diagnosis logic now comes from `@secondlayer/sdk` (`buildDoctorReport`, `isSuccessDelivery`) instead of a local copy in the CLI.
