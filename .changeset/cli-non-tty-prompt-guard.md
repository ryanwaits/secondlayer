---
"@secondlayer/cli": patch
---

Refuse to render the destructive-action confirm prompt on non-TTY stdin. `sl subgraphs delete` and `sl subscriptions delete/rotate-secret/requeue/replay` now check `process.stdin.isTTY` up front; if stdin is a pipe (e.g. `echo |`) or otherwise non-interactive, they print "Interactive prompt unavailable (stdin is not a TTY). Re-run with -y to skip confirmation." and exit 1. The previous catch-after-error path only handled fully-closed stdin and silently auto-accepted the destructive default when given an empty pipe.
