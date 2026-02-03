import { test, expect } from "bun:test";
import { generateViewSQL } from "../src/schema/generator.ts";
import type { ViewDefinition } from "../src/types.ts";

const baseDef: ViewDefinition = {
  name: "token-transfers",
  sources: [{ contract: "SP000::token", event: "transfer" }],
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal" },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint", indexed: true },
        memo: { type: "text", nullable: true },
      },
    },
  },
  handlers: { "*": async () => {} },
};

test("generates CREATE SCHEMA statement", () => {
  const { statements } = generateViewSQL(baseDef);
  expect(statements[0]).toBe("CREATE SCHEMA IF NOT EXISTS view_token_transfers");
});

test("generates CREATE TABLE with auto-columns", () => {
  const { statements } = generateViewSQL(baseDef);
  const createTable = statements[1]!;
  expect(createTable).toContain("view_token_transfers.transfers");
  expect(createTable).toContain("_id BIGSERIAL PRIMARY KEY");
  expect(createTable).toContain("_block_height BIGINT NOT NULL");
  expect(createTable).toContain("_tx_id TEXT NOT NULL");
  expect(createTable).toContain("_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
});

test("maps column types correctly", () => {
  const { statements } = generateViewSQL(baseDef);
  const createTable = statements[1]!;
  expect(createTable).toContain("sender TEXT NOT NULL");
  expect(createTable).toContain("amount BIGINT NOT NULL");
  expect(createTable).toContain("memo TEXT"); // nullable — no NOT NULL
});

test("generates indexes for indexed columns", () => {
  const { statements } = generateViewSQL(baseDef);
  const indexStatements = statements.filter((s) => s.includes("CREATE INDEX"));
  // 2 auto (block_height, tx_id) + 2 user (recipient, amount)
  expect(indexStatements.length).toBe(4);
  expect(indexStatements.some((s) => s.includes("recipient"))).toBe(true);
  expect(indexStatements.some((s) => s.includes("amount"))).toBe(true);
});

test("produces stable hash for same schema", () => {
  const { hash: hash1 } = generateViewSQL(baseDef);
  const { hash: hash2 } = generateViewSQL(baseDef);
  expect(hash1).toBe(hash2);
});

test("hash changes when schema changes", () => {
  const modified: ViewDefinition = {
    ...baseDef,
    schema: {
      transfers: {
        columns: {
          ...baseDef.schema.transfers!.columns,
          newcol: { type: "boolean" },
        },
      },
    },
  };
  const { hash: h1 } = generateViewSQL(baseDef);
  const { hash: h2 } = generateViewSQL(modified);
  expect(h1).not.toBe(h2);
});

test("converts hyphens to underscores in schema name", () => {
  const { statements } = generateViewSQL(baseDef);
  expect(statements[0]).toContain("view_token_transfers");
});

test("generates all column types", () => {
  const def: ViewDefinition = {
    name: "all-types",
    sources: [{ contract: "SP::c" }],
    schema: {
      data: {
        columns: {
          a: { type: "text" },
          b: { type: "uint" },
          c: { type: "int" },
          d: { type: "principal" },
          e: { type: "boolean" },
          f: { type: "timestamp" },
          g: { type: "jsonb" },
        },
      },
    },
    handlers: { "*": () => {} },
  };
  const { statements } = generateViewSQL(def);
  const table = statements[1]!;
  expect(table).toContain("a TEXT");
  expect(table).toContain("b BIGINT");
  expect(table).toContain("c INTEGER");
  expect(table).toContain("d TEXT");
  expect(table).toContain("e BOOLEAN");
  expect(table).toContain("f TIMESTAMPTZ");
  expect(table).toContain("g JSONB");
});

test("generates multiple tables", () => {
  const def: ViewDefinition = {
    name: "marketplace",
    sources: [{ contract: "SP::nft" }],
    schema: {
      listings: {
        columns: { price: { type: "uint" } },
      },
      sales: {
        columns: { buyer: { type: "principal" } },
      },
    },
    handlers: { "*": () => {} },
  };
  const { statements } = generateViewSQL(def);
  const creates = statements.filter((s) => s.startsWith("CREATE TABLE"));
  expect(creates.length).toBe(2);
  expect(creates[0]).toContain("view_marketplace.listings");
  expect(creates[1]).toContain("view_marketplace.sales");
});

test("generates composite indexes", () => {
  const def: ViewDefinition = {
    name: "indexed",
    sources: [{ contract: "SP::c" }],
    schema: {
      data: {
        columns: {
          seller: { type: "principal" },
          status: { type: "text" },
        },
        indexes: [["seller", "status"]],
      },
    },
    handlers: { "*": () => {} },
  };
  const { statements } = generateViewSQL(def);
  const compositeIdx = statements.find((s) => s.includes("composite_0"));
  expect(compositeIdx).toBeDefined();
  expect(compositeIdx).toContain("(seller, status)");
});
