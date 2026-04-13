---
"@secondlayer/web": patch
---

Backfill the public marketing docs for everything P1 shipped:

- `/workflows`: new sections for **Templates**, **Chat authoring**, **Versioning & rollback**, and **Live tail**. Expanded **Deploy** + **Management** code blocks to cover `sourceCode`, `expectedVersion`, `dryRun`, `clientRequestId`, `VersionConflictError`, `getSource`, `rollback`, `pauseAll`, `cancelRun`, and `streamRun`. New Props groups for the extended SDK surface, `VersionConflictError`, `WorkflowSource`, and `WorkflowTailEvent`.
- `/sdk`: `SecondLayer` constructor now documents the `origin` option and the `x-sl-origin` header. Workflows code block shows the full deploy / source / rollback / tail surface. Error-handling section lists `VersionConflictError`, `ApiError.body`, and the new 409 / 413 status codes. Props table updated with the new methods and a dedicated **Errors** group.
- `/cli`: Subgraphs and Workflows sections now credit `@secondlayer/bundler` (typed size caps, externalised packages) and explain that CLI deploys carry the original TypeScript source so chat edits work immediately.
