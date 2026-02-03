import { describe, test, expect, beforeAll } from "bun:test";

const INDEXER_URL = process.env.INDEXER_URL || "http://localhost:3700";
const HAS_DB = !!process.env.DATABASE_URL;

let CAN_RUN = HAS_DB;
if (HAS_DB) {
  try {
    const res = await fetch(`${INDEXER_URL}/health`);
    CAN_RUN = res.ok;
  } catch {
    CAN_RUN = false;
  }
}

describe.skipIf(!CAN_RUN)("Integrity health endpoint (Sprint 4)", () => {
  test("GET /health/integrity returns integrity status", async () => {
    const res = await fetch(`${INDEXER_URL}/health/integrity`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("lastContiguousBlock");
    expect(data).toHaveProperty("lastIndexedBlock");
    expect(data).toHaveProperty("gapCount");
    expect(data).toHaveProperty("totalMissingBlocks");
    expect(data).toHaveProperty("autoBackfillEnabled");
    expect(data).toHaveProperty("autoBackfillProgress");

    const progress = data.autoBackfillProgress as Record<string, unknown>;
    expect(progress).toHaveProperty("remaining");
    expect(progress).toHaveProperty("inProgress");
  });

  test("status is 'healthy' or 'gaps_detected'", async () => {
    const res = await fetch(`${INDEXER_URL}/health/integrity`);
    const data = (await res.json()) as { status: string };
    expect(["healthy", "degraded", "gaps_detected"]).toContain(data.status);
  });
});
