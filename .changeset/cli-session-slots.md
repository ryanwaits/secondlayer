---
"@secondlayer/cli": patch
---

One bad or email-less login no longer wipes every saved login: the session file is read slot by slot, a session is validated before it is written, and an account with no email is a valid login. Config and session files now resolve the same home directory (`HOME` first).
