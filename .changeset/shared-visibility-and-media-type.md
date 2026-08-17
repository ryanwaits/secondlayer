---
"@secondlayer/shared": major
---

Drop the subgraph visibility surface, and add the media-type error used by the write-plane guard.

Removed with publish/unpublish:

- `findPublicSubgraphByName()` and `updateSubgraphVisibility()` — nothing writes the column anymore
- `visibility` on `DeploySubgraphRequest` (interface and schema) and on `DeploySubgraphResponse`
- `PUBLIC_NAME_TAKEN` from `CODE_TO_STATUS`

Added: `UNSUPPORTED_MEDIA_TYPE` (415), raised when a write arrives without a JSON content type.

Generated subgraph specs now default their server URL to `http://127.0.0.1:3800` instead of the
hosted API, so a spec produced on a self-hosted instance describes that instance.

The `subgraphs.visibility` column and its unique index are still in place; nothing writes them.
Dropping them needs a migration and is tracked separately.
