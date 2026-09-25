---
"@secondlayer/web": minor
---

Added `/account/webhooks`: a list and detail view for a hosted account's webhooks, with the last 100 delivery attempts (charted), a diagnosis, failed-event resend (one or all), test, pause/resume, secret rotation and delete. Create and edit stay CLI/SDK-only. Opening the page never starts a delivery service on an account that hasn't used webhooks yet, and the out-of-credits notice now links to a real page.
