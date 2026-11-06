<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Tests

- Unit tests are for logic: pure functions, parsers, stores, route handlers, config/contract guards. `bun test` stays fast and free.
- Security guards stay even when they assert on HTML: escaping of untrusted text, no secret in server output.
- No markup, render, class-name, copy or source-scan tests. UI changes are proven with agent-browser instead: screenshots light + dark, desktop + 390 px, CLS, and network log in the change report.
- Touching UI never requires editing a test. If it does, that test is the wrong kind; delete it.
