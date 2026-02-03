import { test, expect } from "bun:test";
import { diffSchema } from "../src/schema/deployer.ts";
import type { ViewSchema } from "../src/types.ts";

const baseSchema: ViewSchema = {
  transfers: {
    columns: {
      sender: { type: "principal" },
      amount: { type: "uint" },
    },
  },
};

test("diffSchema detects no changes", () => {
  const diff = diffSchema(baseSchema, baseSchema);
  expect(diff.addedTables).toEqual([]);
  expect(diff.removedTables).toEqual([]);
  expect(diff.tables.transfers?.added).toEqual([]);
  expect(diff.tables.transfers?.removed).toEqual([]);
  expect(diff.tables.transfers?.changed).toEqual([]);
});

test("diffSchema detects added columns", () => {
  const incoming: ViewSchema = {
    transfers: {
      columns: {
        sender: { type: "principal" },
        amount: { type: "uint" },
        memo: { type: "text", nullable: true },
      },
    },
  };
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.addedTables).toEqual([]);
  expect(diff.tables.transfers?.added).toEqual(["memo"]);
  expect(diff.tables.transfers?.removed).toEqual([]);
});

test("diffSchema detects removed columns", () => {
  const incoming: ViewSchema = {
    transfers: {
      columns: {
        sender: { type: "principal" },
      },
    },
  };
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.tables.transfers?.removed).toEqual(["amount"]);
});

test("diffSchema detects changed columns", () => {
  const incoming: ViewSchema = {
    transfers: {
      columns: {
        sender: { type: "text" }, // was principal
        amount: { type: "uint" },
      },
    },
  };
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.tables.transfers?.changed).toEqual(["sender"]);
});

test("diffSchema detects added tables", () => {
  const incoming: ViewSchema = {
    ...baseSchema,
    sales: {
      columns: { buyer: { type: "principal" } },
    },
  };
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.addedTables).toEqual(["sales"]);
  expect(diff.removedTables).toEqual([]);
});

test("diffSchema detects removed tables", () => {
  const incoming: ViewSchema = {};
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.removedTables).toEqual(["transfers"]);
  expect(diff.addedTables).toEqual([]);
});

test("diffSchema detects mixed table and column changes", () => {
  const incoming: ViewSchema = {
    transfers: {
      columns: {
        sender: { type: "text" }, // changed
        // amount removed
        memo: { type: "text" }, // added
      },
    },
    sales: { // added table
      columns: { buyer: { type: "principal" } },
    },
  };
  const diff = diffSchema(baseSchema, incoming);
  expect(diff.addedTables).toEqual(["sales"]);
  expect(diff.removedTables).toEqual([]);
  expect(diff.tables.transfers?.added).toEqual(["memo"]);
  expect(diff.tables.transfers?.removed).toEqual(["amount"]);
  expect(diff.tables.transfers?.changed).toEqual(["sender"]);
});
