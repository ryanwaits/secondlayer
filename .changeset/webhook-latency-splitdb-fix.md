---
"@secondlayer/shared": patch
---

Fixes a prod regression under a split source/target database: `queue/listener.ts`'s `sourceListenerUrl()`/`targetListenerUrl()` re-derived the `SOURCE_DATABASE_URL`/`TARGET_DATABASE_URL` env-var precedence by hand and skipped the `isPlatformMode()` gate `getSourceDb()`/`getTargetDb()` apply, so a process not in platform mode (but with those vars set anyway) could LISTEN on a different database than the one a write actually committed and NOTIFYed on. Both now delegate to the same `resolveSourceUrl()`/`resolveTargetUrl()` the writers use (now exported), plus `describeDbUrl()` for redacted startup logging of which host a listener connected to. `IndexHttpClient.getIndexTip()`'s `wait` also gained a `tip_only` request flag (see the `@secondlayer/api` changeset) with a matching client-side fallback when an older server rejects it.
