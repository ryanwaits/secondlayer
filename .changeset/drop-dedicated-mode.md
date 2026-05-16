---
"@secondlayer/shared": minor
---

Drop `"dedicated"` from the `InstanceMode` union and remove `isDedicatedMode()`. The shared-rip pivot has been live for two days; nothing references the dedicated branch in source. Delete unused `db/queries/tenants.ts`. Add migration 0076 marking the `tenants` table deprecated (data preserved for one observation window; a follow-up migration will DROP).
