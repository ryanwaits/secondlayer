---
"@secondlayer/api": minor
"@secondlayer/shared": minor
"@secondlayer/web": patch
---

Hosted LLM surfaces removed (Sessions + command-palette agent). Bring your own agent harness via MCP/skills/prompts instead. `chat_sessions`/`chat_messages` tables dropped (migration 0097); `POST /me/meter` endpoint and the `ai_evals` Stripe meter removed.
