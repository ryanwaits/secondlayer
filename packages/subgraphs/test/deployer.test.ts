import { expect, test } from "bun:test";
import { diffSchema } from "../src/schema/deployer.ts";
import type { SubgraphSchema } from "../src/types.ts";

const baseSchema: SubgraphSchema = {
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
	const incoming: SubgraphSchema = {
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
	const incoming: SubgraphSchema = {
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
	const incoming: SubgraphSchema = {
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
	const incoming: SubgraphSchema = {
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
	const incoming: SubgraphSchema = {};
	const diff = diffSchema(baseSchema, incoming);
	expect(diff.removedTables).toEqual(["transfers"]);
	expect(diff.addedTables).toEqual([]);
});

test("diffSchema detects mixed table and column changes", () => {
	const incoming: SubgraphSchema = {
		transfers: {
			columns: {
				sender: { type: "text" }, // changed
				// amount removed
				memo: { type: "text" }, // added
			},
		},
		sales: {
			// added table
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

// ── Index flags and constraints: never a rebuild ─────────────────────

import { hasBreakingChanges } from "../src/schema/deployer.ts";

const baseColumns = {
	sender: { type: "principal" },
	amount: { type: "uint" },
} satisfies SubgraphSchema[string]["columns"];

test("flipping indexed on a populated column is indexChanged, not breaking", () => {
	const incoming: SubgraphSchema = {
		transfers: {
			columns: {
				sender: { type: "principal", indexed: true },
				amount: { type: "uint" },
			},
		},
	};
	const diff = diffSchema(baseSchema, incoming);
	expect(diff.tables.transfers?.changed).toEqual([]);
	expect(diff.tables.transfers?.indexChanged).toEqual(["sender"]);
	expect(hasBreakingChanges(diff).breaking).toBe(false);
});

test("flipping search is indexChanged, not breaking", () => {
	const incoming: SubgraphSchema = {
		transfers: {
			columns: {
				sender: { type: "principal", search: true },
				amount: { type: "uint" },
			},
		},
	};
	const diff = diffSchema(baseSchema, incoming);
	expect(diff.tables.transfers?.indexChanged).toEqual(["sender"]);
	expect(hasBreakingChanges(diff).breaking).toBe(false);
});

test("a type change is still breaking, even alongside a flag flip", () => {
	const incoming: SubgraphSchema = {
		transfers: {
			columns: {
				sender: { type: "text", indexed: true },
				amount: { type: "uint" },
			},
		},
	};
	const diff = diffSchema(baseSchema, incoming);
	expect(diff.tables.transfers?.changed).toEqual(["sender"]);
	expect(diff.tables.transfers?.indexChanged).toEqual([]);
	expect(hasBreakingChanges(diff).breaking).toBe(true);
});

test("adding a uniqueKey is visible and non-breaking", () => {
	const incoming: SubgraphSchema = {
		transfers: {
			columns: baseColumns,
			uniqueKeys: [["sender", "amount"]],
		},
	};
	const diff = diffSchema(baseSchema, incoming);
	expect(diff.constraints.transfers?.addedUniqueKeys).toEqual([
		["sender", "amount"],
	]);
	expect(hasBreakingChanges(diff).breaking).toBe(false);
});

test("removing a uniqueKey is breaking (upserts target it)", () => {
	const existing: SubgraphSchema = {
		transfers: {
			columns: baseColumns,
			uniqueKeys: [["sender", "amount"]],
		},
	};
	const diff = diffSchema(existing, baseSchema);
	expect(diff.constraints.transfers?.removedUniqueKeys).toEqual([
		["sender", "amount"],
	]);
	const verdict = hasBreakingChanges(diff);
	expect(verdict.breaking).toBe(true);
	expect(verdict.reasons.join(" ")).toContain("uniqueKeys");
});

test("composite index changes are visible and non-breaking", () => {
	const existing: SubgraphSchema = {
		transfers: {
			columns: baseColumns,
			indexes: [["sender"]],
		},
	};
	const incoming: SubgraphSchema = {
		transfers: {
			columns: baseColumns,
			indexes: [["sender", "amount"]],
		},
	};
	const diff = diffSchema(existing, incoming);
	expect(diff.constraints.transfers?.addedIndexes).toEqual([
		["sender", "amount"],
	]);
	expect(diff.constraints.transfers?.removedIndexes).toEqual([["sender"]]);
	expect(hasBreakingChanges(diff).breaking).toBe(false);
});
