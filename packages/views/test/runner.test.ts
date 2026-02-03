import { test, expect, describe } from "bun:test";
import { runHandlers } from "../src/runtime/runner.ts";
import type { ViewDefinition } from "../src/types.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";

// Minimal mock context that tracks calls
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

const matched: MatchedTx[] = [
  {
    tx: { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success", contract_id: "SP::c", function_name: "transfer" },
    events: [
      { id: "e1", tx_id: "tx1", type: "ft_transfer_event", event_index: 0, data: { amount: "1000" } },
      { id: "e2", tx_id: "tx1", type: "ft_transfer_event", event_index: 1, data: { amount: "2000" } },
    ],
    sourceKey: "SP::c",
  },
];

describe("runHandlers", () => {
  test("calls handler for each event", async () => {
    let callCount = 0;
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "SP::c": () => { callCount++; } },
    };

    const ctx = mockCtx();
    const result = await runHandlers(view, matched, ctx as any);
    expect(callCount).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.errors).toBe(0);
  });

  test("falls back to catch-all handler", async () => {
    let callCount = 0;
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "*": () => { callCount++; } },
    };

    const ctx = mockCtx();
    await runHandlers(view, matched, ctx as any);
    expect(callCount).toBe(2);
  });

  test("skips when no matching handler", async () => {
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "SP::other": () => {} },
    };

    const ctx = mockCtx();
    const result = await runHandlers(view, matched, ctx as any);
    expect(result.processed).toBe(0);
  });

  test("sets tx context per matched tx", async () => {
    const seenTxIds: string[] = [];
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "SP::c": (_event, ctx: any) => { seenTxIds.push(ctx.tx.txId); } },
    };

    const ctx = mockCtx();
    await runHandlers(view, matched, ctx as any);
    expect(seenTxIds).toEqual(["tx1", "tx1"]);
  });

  test("catches handler errors and continues", async () => {
    let callCount = 0;
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: {
        "SP::c": () => {
          callCount++;
          if (callCount === 1) throw new Error("fail");
        },
      },
    };

    const ctx = mockCtx();
    const result = await runHandlers(view, matched, ctx as any);
    expect(callCount).toBe(2);
    expect(result.processed).toBe(1);
    expect(result.errors).toBe(1);
  });

  test("stops at error threshold", async () => {
    let callCount = 0;
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "SP::c": () => { callCount++; throw new Error("always fail"); } },
    };

    const manyEvents: MatchedTx[] = [{
      tx: { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success" },
      events: Array.from({ length: 10 }, (_, i) => ({
        id: `e${i}`, tx_id: "tx1", type: "event", event_index: i, data: {},
      })),
      sourceKey: "SP::c",
    }];

    const ctx = mockCtx();
    const result = await runHandlers(view, manyEvents, ctx as any, { errorThreshold: 3 });
    expect(result.errors).toBe(3);
    expect(callCount).toBe(3);
  });

  test("calls handler with tx-level data when no events", async () => {
    let received: Record<string, unknown> | null = null;
    const view: ViewDefinition = {
      name: "test",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "SP::c": (event) => { received = event; } },
    };

    const noEvents: MatchedTx[] = [{
      tx: { tx_id: "tx1", type: "contract_call", sender: "SP1", status: "success" },
      events: [],
      sourceKey: "SP::c",
    }];

    const ctx = mockCtx();
    await runHandlers(view, noEvents, ctx as any);
    expect(received).not.toBeNull();
    expect((received as any).tx.txId).toBe("tx1");
  });
});
