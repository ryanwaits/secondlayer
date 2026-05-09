---
"@secondlayer/cli": patch
---

feat(cli): prompt magic-link login on `sl subgraphs deploy` when no session

Previously, running `sl subgraphs deploy file.ts` against a remote network with no CLI session bailed with a generic 401 deep inside the deploy flow. New `requireAuth()` helper in `packages/cli/src/lib/require-auth.ts` checks for a session and runs the magic-link login flow inline if missing, then resumes the deploy. Local-network deploys are unaffected.
