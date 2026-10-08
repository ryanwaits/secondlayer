---
"@secondlayer/sdk": minor
"@secondlayer/mcp": patch
---

Failed calls keep the API's error envelope. SDK: `ApiError.requestId` (from the body's `request_id`) and `toJSON()` now include `status` and `requestId`. MCP: tool errors return `code`, `request_id` and `feedback.url` when the API sent them, so an agent can quote the exact failed call.
