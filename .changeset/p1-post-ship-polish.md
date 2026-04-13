---
"@secondlayer/api": patch
"@secondlayer/web": patch
---

Post-P1 workflows authoring loop polish.

- **API**: `POST /api/workflows` and `/api/workflows/bundle` now auto-resolve session-auth requests to the account's first active API key, so chat deploys no longer 401 when the caller only has a session cookie.
- **Web**: `manage_workflows` wired as a human-in-loop tool with a structured action handler (trigger/pause/resume/delete), so the card no longer hangs after approval.
- **Web**: live step tail now renders each completed step's output (JSON-formatted) instead of only showing errors.
- **Web**: run ID entries in the workflow runs table are now styled as accent-colored links pointing at the existing run detail page.
