import { test, expect, describe } from "bun:test";
import { runHandlers } from "../src/runtime/runner.ts";
import type { ViewDefinition } from "../src/types.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";

function mockCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    block: { height: 100, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
    tx: { txId: "", sender: "", type: "", status: "" },
    setTx(tx: any) { this.tx = tx; },
    insert(table: string, row: any) { calls.push({ method: "insert", args: [table, row] }); },
    update(table: string, where: any, set: any) { calls.push({ method: "update", args: [table, where, set] }); },
    delete(table: string, where: any) { calls.push({ method: "delete", args: [table, where] }); },
    pendingOps: 0,
    async flush() { return 0; },
  };
}

const matched: MatchedTx[] = [{
  tx: { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success" },
  events: [
    { id: "e1", tx_id: "tx1", type: "event", event_index: 0, data: {} },
  ],
  sourceKey: "SP::c",
}];

describe("view isolation", () => {
  test("slow handler triggers timeout via error threshold", async () => {
    let callCount = 0;
    const view: ViewDefinition = {
      name: "slow-view",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": async () => {
          callCount++;
          // Simulate slow handler that exceeds per-event timeout
          await new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 10),
          );
        },
      },
    };

    const manyEvents: MatchedTx[] = [{
      tx: { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success" },
      events: Array.from({ length: 5 }, (_, i) => ({
        id: `e${i}`, tx_id: "tx1", type: "event", event_index: i, data: {},
      })),
      sourceKey: "SP::c",
    }];

    const ctx = mockCtx();
    const result = await runHandlers(view, manyEvents, ctx as any, { errorThreshold: 3 });
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThanOrEqual(3);
  });

  test("one view error does not block other views", async () => {
    const results: string[] = [];

    const failingView: ViewDefinition = {
      name: "failing-view",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => { throw new Error("view1 exploded"); },
      },
    };

    const healthyView: ViewDefinition = {
      name: "healthy-view",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => { results.push("healthy processed"); },
      },
    };

    // Simulate Promise.allSettled processing (mirrors processor.ts pattern)
    const outcomes = await Promise.allSettled([
      (async () => {
        const ctx = mockCtx();
        return runHandlers(failingView, matched, ctx as any);
      })(),
      (async () => {
        const ctx = mockCtx();
        return runHandlers(healthyView, matched, ctx as any);
      })(),
    ]);

    // Failing view should have errors but not crash
    const failResult = outcomes[0]!;
    expect(failResult.status).toBe("fulfilled");
    if (failResult.status === "fulfilled") {
      expect(failResult.value.errors).toBe(1);
    }

    // Healthy view should process normally
    const healthyResult = outcomes[1]!;
    expect(healthyResult.status).toBe("fulfilled");
    if (healthyResult.status === "fulfilled") {
      expect(healthyResult.value.processed).toBe(1);
      expect(healthyResult.value.errors).toBe(0);
    }

    expect(results).toEqual(["healthy processed"]);
  });

  test("empty block (0 matched events) does not error", async () => {
    const view: ViewDefinition = {
      name: "empty-block-view",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => { throw new Error("should not be called"); },
      },
    };

    const ctx = mockCtx();
    const result = await runHandlers(view, [], ctx as any);
    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
  });

  test("overlapping sources: 2 views match same event, both process independently", async () => {
    const results: string[] = [];

    const view1: ViewDefinition = {
      name: "view-a",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => { results.push("view-a"); },
      },
    };

    const view2: ViewDefinition = {
      name: "view-b",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => { results.push("view-b"); },
      },
    };

    const outcomes = await Promise.allSettled([
      (async () => {
        const ctx = mockCtx();
        return runHandlers(view1, matched, ctx as any);
      })(),
      (async () => {
        const ctx = mockCtx();
        return runHandlers(view2, matched, ctx as any);
      })(),
    ]);

    expect(outcomes[0]!.status).toBe("fulfilled");
    expect(outcomes[1]!.status).toBe("fulfilled");
    expect(results).toContain("view-a");
    expect(results).toContain("view-b");
    expect(results.length).toBe(2);
  });
});
