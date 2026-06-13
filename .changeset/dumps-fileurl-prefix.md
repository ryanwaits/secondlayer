---
"@secondlayer/sdk": patch
"@secondlayer/cli": patch
---

Fix dumps file downloads 404ing: manifest file paths are bucket-root-absolute while dumpsBaseUrl ends with the dataset prefix — fileUrl now strips the overlap so list() and download() resolve from one base URL (fixes `sl streams pull` and `events.replay` against prod dumps)
