---
"@secondlayer/shared": patch
---

Adds `closeDbOrTimeout`, a bounded variant of `closeDb` for one-shot scripts: a hung connection-pool shutdown can no longer stop a script from exiting once its actual work is done.
