---
"@secondlayer/web": patch
---

The webhooks list and detail pages now render cached rows instantly, fetch in parallel instead of serially, and keep updating while the tab is open. A skeleton fills the wait on a first load, hovering a row prefetches its detail page, and detail charts load in their own chunk behind the page's first content.
