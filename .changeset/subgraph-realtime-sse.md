---
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": minor
---

Add realtime subgraph row streaming over Server-Sent Events. A new endpoint `GET /api/subgraphs/<name>/<table>/stream` pushes rows as they're indexed (go-forward by default, `?since=<block>` to replay then tail), accepting the same column filters as the list endpoint. The SDK's typed client gains `subgraph.<table>.subscribe(onRow, { where, since })`, which opens the stream and returns an unsubscribe function — a browser-friendly way to react to indexed data live without running a webhook receiver.
