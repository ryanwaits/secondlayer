---
"@secondlayer/cli": patch
---

fix(cli): write the session file via temp+rename at mode 0600 so it's never
briefly world-readable, and narrow an existing wrong-mode file on overwrite
