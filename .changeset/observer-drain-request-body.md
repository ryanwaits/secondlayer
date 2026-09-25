---
"@secondlayer/indexer": patch
---

fix(indexer): read observer request bodies before replying

The `/attachments/new` no-op and the 404 fallback replied without reading the request body. On a large POST, Bun sent the response and closed the socket while stacks-node was still writing it, which the node's event dispatcher treats as a failed delivery and retries forever, blocking everything queued behind it. Both handlers now drain the body first.
