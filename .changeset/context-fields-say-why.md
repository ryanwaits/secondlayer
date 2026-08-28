---
"@secondlayer/mcp": minor
"@secondlayer/cli": minor
---

`secondlayer context` and the `secondlayer://context` resource carry the reason a field is missing. The SDK snapshot now reports `{ value, error? }` per field; the CLI prints the flat snapshot plus an `errors` map with the API's code and status, and the MCP resource replaces a bare `unavailable` sentinel with the failure message when there is one, so an agent can tell an unreachable API from a rejected token.
