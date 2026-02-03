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
  },
};

const block: BlockMeta = { height: 100, hash: "0xabc", timestamp: 1700000000, burnBlockHeight: 50 };
const tx: TxMeta = { txId: "0xtx1", sender: "SP123", type: "contract_call", status: "success" };

// We can't test actual DB operations without a DB, but we can test the API surface
// and validation logic.

describe("ViewContext", () => {
  test("validates table names on insert", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    expect(() => ctx.insert("nonexistent", { sender: "SP1" })).toThrow('Table "nonexistent" not found');
  });

  test("validates table names on update", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    expect(() => ctx.update("nope", { sender: "SP1" }, { amount: 100 })).toThrow('Table "nope" not found');
  });

  test("validates table names on delete", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    expect(() => ctx.delete("bad", { sender: "SP1" })).toThrow('Table "bad" not found');
  });

  test("accepts valid table names", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.insert("transfers", { sender: "SP1", amount: 100 });
    ctx.insert("balances", { address: "SP1", balance: 500 });
    expect(ctx.pendingOps).toBe(2);
  });

  test("batches operations until flush", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.insert("transfers", { sender: "SP1", amount: 100 });
    ctx.update("balances", { address: "SP1" }, { balance: 600 });
    ctx.delete("transfers", { sender: "SP2" });
    expect(ctx.pendingOps).toBe(3);
  });

  test("exposes block metadata", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    expect(ctx.block.height).toBe(100);
    expect(ctx.block.hash).toBe("0xabc");
  });

  test("exposes and updates tx metadata", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    expect(ctx.tx.txId).toBe("0xtx1");

    ctx.setTx({ txId: "0xtx2", sender: "SP456", type: "token_transfer", status: "success" });
    expect(ctx.tx.txId).toBe("0xtx2");
    expect(ctx.tx.sender).toBe("SP456");
  });

  test("upsert adds to pending ops", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    ctx.upsert("balances", { address: "SP1" }, { balance: 500 });
    expect(ctx.pendingOps).toBe(1);
  });

  test("error message lists available tables", () => {
    const ctx = new ViewContext(null as any, "view_test", schema, block, tx);
    try {
      ctx.insert("bad", {});
    } catch (e) {
      expect((e as Error).message).toContain("transfers");
      expect((e as Error).message).toContain("balances");
    }
  });
});
