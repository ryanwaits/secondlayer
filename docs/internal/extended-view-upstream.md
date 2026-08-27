# /extended view vs Labs OpenAPI

We project a subset of the Stacks Blockchain API /extended JSON from
Index rows. We do not run their image or restore their PG dump.

On a Labs API release:
1. Read github.com/hirosystems/stacks-blockchain-api/releases
2. Diff their OpenAPI against packages/api/src/extended/openapi/*-subset.yaml
3. For each changed path we implement: update the subset, update the
   mapper in packages/api/src/extended/, add a test
4. For new required fields we do not persist: add them to the
   "Deliberately not required" list — do not fabricate
5. Do not bump a docker digest. There is no SBA container.

/v2 is not this surface.
