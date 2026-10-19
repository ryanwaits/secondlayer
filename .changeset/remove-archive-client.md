---
"@secondlayer/shared": major
---

Remove the `./node/archive-client` subpath (`ArchiveReplayClient`). It replayed Hiro event-archive TSVs but misread their Postgres COPY escaping, so the blocks it posted were wrong. Backfill from a node, the Hiro API, `hiro-pg`, or a signed archive (`secondlayer bootstrap`) instead.
