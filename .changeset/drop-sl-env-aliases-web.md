---
"@secondlayer/web": patch
---

The web app's platform API client now reads `SECONDLAYER_API_URL` instead of `SL_API_URL`, and defaults to `https://api.secondlayer.tools` in production (previously `http://localhost:3800` always, which needed an env var override in prod). Dev still defaults to the local one-box API.
