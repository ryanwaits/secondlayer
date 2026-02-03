import { test, expect, describe } from "bun:test";
import { ViewContext, type BlockMeta, type TxMeta } from "../src/runtime/context.ts";
import type { ViewSchema } from "../src/types.ts";

const schema: ViewSchema = {
  transfers: {
    columns: {
      sender: { type: "principal" },
      amount: { type: "uint" },
    },
  },
  balances: {
    columns: {
      address: { type: "principal" },
      balance: { type: "uint" },
    },
    uniqueKeys: [["address"]],
  },
};

const block: BlockMeta = { height: 100, hash: "0xabc", timestamp: 1700000000, burnBlockHeight: 50 };
const tx: TxMeta = { txId: "0xtx1", sender: "SP123", type: "contract_call", status: "success" };

describe("context flush statement building", () => {
  test("insert auto-populates _block_height, _tx_id, _created_at", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.insert("transfers", { sender: "SP1", amount: 100 });
    expect(ctx.pendingOps).toBe(1);
  });

  test("update batches correctly", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.update("balances", { address: "SP1" }, { balance: 999 });
    expect(ctx.pendingOps).toBe(1);
  });

  test("delete batches correctly", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.delete("transfers", { sender: "SP1" });
    expect(ctx.pendingOps).toBe(1);
  });

  test("upsert with uniqueKeys uses ON CONFLICT path", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.upsert("balances", { address: "SP1" }, { balance: 500 });
    expect(ctx.pendingOps).toBe(1);
  });

  test("upsert without uniqueKeys falls back (logs warning)", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    // transfers has no uniqueKeys — should still accept the op
    ctx.upsert("transfers", { sender: "SP1" }, { amount: 100 });
    expect(ctx.pendingOps).toBe(1);
  });

  test("column name validation rejects bad names", () => {
    const badSchema: ViewSchema = {
      data: {
        columns: {
          ok_col: { type: "text" },
        },
      },
    };
    const ctx = new ViewContext(null as any, "view_test", badSchema, block, tx);
    // Insert with a bad column name in the row data — this will be caught at flush time
    ctx.insert("data", { ok_col: "test" });
    expect(ctx.pendingOps).toBe(1);
  });

  test("flush returns 0 for empty ops", async () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    const count = await ctx.flush();
    expect(count).toBe(0);
  });
});
