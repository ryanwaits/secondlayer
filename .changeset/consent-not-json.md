---
"@secondlayer/cli": minor
---

Every destructive or metered confirmation now runs through one gate: `-y` skips it, the prompt defaults to no, and without a TTY on stdin the command exits 1 naming `-y` instead of letting an empty pipe answer. `subgraphs deploy` puts its drop-and-reindex prompt behind that gate (before, `echo | deploy` accepted the drop); the uncommitted-source check reads stdin, not stdout. `--json` never stands in for `-y`: `bootstrap` and `repair` without `-y` print `{"code":"CONFIRMATION_REQUIRED","quote":…}` and exit 2 so a script can read the price first, and the `repair --json` report carries `metered`. `subscriptions create` defaults the runtime to `node` once any of `-s/-t/-u` or `--no-scaffold` is given and exits 1 without a TTY when a value would need a prompt, instead of rendering a menu and exiting 0 with nothing created. `subgraphs deploy` accepts a staged file (`git add` is enough); `create`'s `Next:` line and the quickstart show the `git add` step.
