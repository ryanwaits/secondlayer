---
"@secondlayer/cli": major
"@secondlayer/sdk": major
"@secondlayer/mcp": major
---

Remove subgraph publish/unpublish and the public/private visibility flag. Publishing claimed a name in a hosted global namespace; a self-hosted instance has no such namespace, so the verb had nothing to mean. There is no shim — the routes 404 and the calls are gone.

- CLI: `subgraphs publish`, `subgraphs unpublish`, and `subgraphs deploy --visibility` are unregistered. Deploy's success footer always prints the `/api/subgraphs` read path.
- SDK: `subgraphs.publish()` / `subgraphs.unpublish()` and the `SubgraphPublishResult` / `SubgraphUnpublishResult` types are removed. `deploy()` no longer accepts `visibility`, and its response no longer returns one.
- MCP: `subgraphs_publish` and `subgraphs_unpublish` are no longer registered, and `subgraphs_list` no longer reports `visibility` or a `publicUrl`.
- HTTP: `POST /api/subgraphs/:name/publish` and `.../unpublish` are deleted and pinned as deleted-route fixtures, so they must 404 in every mode. The `PUBLIC_NAME_TAKEN` (409) error code is retired with them.

Reads are unchanged: rows still come from `/api/subgraphs/<name>/<table>` on a self-hosted instance, and the open `/v1/subgraphs` directory still serves what it served.
