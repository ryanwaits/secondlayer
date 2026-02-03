import { test, expect } from "bun:test";
import { validateViewDefinition, ViewNameSchema } from "../src/validate.ts";

test("ViewNameSchema rejects invalid names", () => {
  expect(() => ViewNameSchema.parse("")).toThrow();
  expect(() => ViewNameSchema.parse("UPPER")).toThrow();
  expect(() => ViewNameSchema.parse("123start")).toThrow();
  expect(() => ViewNameSchema.parse("has spaces")).toThrow();
  expect(() => ViewNameSchema.parse("has_underscore")).toThrow();
});

test("ViewNameSchema accepts valid names", () => {
  expect(ViewNameSchema.parse("my-view")).toBe("my-view");
  expect(ViewNameSchema.parse("view123")).toBe("view123");
  expect(ViewNameSchema.parse("a")).toBe("a");
});

test("validateViewDefinition accepts valid definition", () => {
  const def = {
    name: "test-view",
    sources: [{ contract: "SP000::contract" }],
    schema: {
      data: { columns: { amount: { type: "uint" } } },
    },
    handlers: { "*": () => {} },
  };

  const result = validateViewDefinition(def);
  expect(result.name).toBe("test-view");
});

test("validateViewDefinition rejects empty schema (no tables)", () => {
  expect(() =>
    validateViewDefinition({
      name: "bad",
      sources: [{ contract: "SP000::c" }],
      schema: {},
      handlers: { "*": () => {} },
    }),
  ).toThrow("Schema must have at least one table");
});

test("validateViewDefinition rejects table with no columns", () => {
  expect(() =>
    validateViewDefinition({
      name: "bad",
      sources: [{ contract: "SP000::c" }],
      schema: { data: { columns: {} } },
      handlers: { "*": () => {} },
    }),
  ).toThrow("Table must have at least one column");
});

test("validateViewDefinition rejects source with neither contract nor type", () => {
  expect(() =>
    validateViewDefinition({
      name: "bad",
      sources: [{ event: "transfer" }],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "*": () => {} },
    }),
  ).toThrow();
});

test("validateViewDefinition rejects empty sources array", () => {
  expect(() =>
    validateViewDefinition({
      name: "bad",
      sources: [],
      schema: { data: { columns: { x: { type: "text" } } } },
      handlers: { "*": () => {} },
    }),
  ).toThrow();
});

test("validateViewDefinition rejects invalid column type", () => {
  expect(() =>
    validateViewDefinition({
      name: "bad",
      sources: [{ contract: "SP::c" }],
      schema: { data: { columns: { x: { type: "invalid" } } } },
      handlers: { "*": () => {} },
    }),
  ).toThrow();
});

test("validateViewDefinition accepts multiple tables", () => {
  const result = validateViewDefinition({
    name: "multi",
    sources: [{ contract: "SP::c" }],
    schema: {
      listings: { columns: { price: { type: "uint" } } },
      sales: { columns: { buyer: { type: "principal" } } },
    },
    handlers: { "*": () => {} },
  });
  expect(Object.keys(result.schema)).toEqual(["listings", "sales"]);
});

test("validateViewDefinition accepts type-based source", () => {
  const result = validateViewDefinition({
    name: "transfers",
    sources: [{ type: "stx_transfer" }],
    schema: {
      data: { columns: { amount: { type: "uint" } } },
    },
    handlers: { "stx_transfer": () => {} },
  });
  expect(result.sources[0]!.type).toBe("stx_transfer");
});

test("validateViewDefinition accepts multiple sources", () => {
  const result = validateViewDefinition({
    name: "multi-src",
    sources: [
      { contract: "SP::marketplace" },
      { contract: "SP::token", event: "transfer" },
      { type: "stx_transfer" },
    ],
    schema: {
      data: { columns: { x: { type: "text" } } },
    },
    handlers: { "*": () => {} },
  });
  expect(result.sources.length).toBe(3);
});
