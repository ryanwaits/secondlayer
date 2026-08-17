---
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": minor
---

Read `INSTANCE_TOKEN` as the primary credential, matching what the docs have always said.

Precedence is now an explicit `apiKey` option, then `INSTANCE_TOKEN`, then `SL_API_KEY`. The old
variable keeps working, so existing setups are unaffected — but following the documentation now
works too. Before this, exporting `INSTANCE_TOKEN` authenticated as nobody with no error, which is
the quietest way a documented happy path can fail.

Setting both to different values warns once on stderr and `INSTANCE_TOKEN` wins; identical values
(what `secondlayer init` writes) never warn.

Note for releases: the CLI and MCP resolve the SDK through its built output, so the SDK bump must
ship before or with them.
