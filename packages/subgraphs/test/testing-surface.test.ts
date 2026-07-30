import { describe, expect, test } from "bun:test";
import { defineSubgraph } from "../src/define.ts";
import { buildEvent, createTestContext } from "../src/testing/index.ts";

/**
 * The test surface's own acceptance criteria:
 *
 * 1. It catches the bns-names bug — a handler reading flat `data.name` while
 *    BNS-V2 emits a nested tuple. That shipped, held 0 rows chain-wide for a
 *    whole release, and cost a redeploy plus a genesis backfill. One fixture
 *    event would have caught it.
 * 2. It is the REAL context: read-your-writes, increment deltas, and upsert
 *    merging behave exactly as they do in production, because they ARE the
 *    production implementation with an in-memory row store.
 */

const bns = defineSubgraph({
	name: "bns-names",
	sources: {
		bns: {
			type: "print_event",
			contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
		},
	},
	schema: {
		names: {
			columns: {
				name: { type: "text" },
				namespace: { type: "text" },
				owner: { type: "principal" },
			},
			uniqueKeys: [["name", "namespace"]],
		},
	},
	handlers: {
		bns: (event, ctx) => {
			// The CORRECT mapping: BNS-V2 nests the name.
			const name = event.data.name as { name: string; namespace: string };
			ctx.insert("names", {
				name: name.name,
				namespace: name.namespace,
				owner: event.data.owner as string,
			});
		},
	},
});

const REGISTER = {
	topic: "name-register",
	data: {
		name: { name: "alice", namespace: "btc" },
		owner: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
	},
};

describe("createTestContext", () => {
	test("runs a handler with no deploy and shows the rows it wrote", async () => {
		const ctx = createTestContext(bns.schema, { block: { height: 167_484 } });
		// biome-ignore lint/style/noNonNullAssertion: handlers are optional by type; this one exists
		await bns.handlers.bns!(buildEvent(bns.sources.bns, REGISTER), ctx);

		const rows = await ctx.rows("names");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			name: "alice",
			namespace: "btc",
			owner: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
		});
		// Block metadata is stamped as the runtime would.
		expect(rows[0]?._block_height).toBe(167_484);
	});

	test("catches the bns-names bug: the flat read writes undefined", async () => {
		// The shipped-broken handler, verbatim in shape: reads flat `data.name`
		// and `data.namespace` while the payload nests them.
		const broken = defineSubgraph({
			...bns,
			handlers: {
				bns: (event, ctx) => {
					ctx.insert("names", {
						name: event.data.name as string,
						namespace: event.data.namespace as string,
						owner: event.data.owner as string,
					});
				},
			},
		});
		const ctx = createTestContext(broken.schema);
		// biome-ignore lint/style/noNonNullAssertion: handler exists
		await broken.handlers.bns!(buildEvent(broken.sources.bns, REGISTER), ctx);

		const rows = await ctx.rows("names");
		// This is what shipped: a row whose namespace is undefined and whose
		// name is an object — 0 usable rows, indefinitely.
		expect(rows[0]?.namespace).toBeUndefined();
		expect(typeof rows[0]?.name).toBe("object");
	});
});

describe("the test context is the real context", () => {
	const counters = defineSubgraph({
		name: "counters",
		sources: { xfer: { type: "ft_transfer" } },
		schema: {
			balances: {
				columns: { holder: { type: "principal" }, amount: { type: "uint" } },
				uniqueKeys: [["holder"]],
			},
		},
		handlers: {},
	});

	test("increment deltas accumulate within a block (not last-write-wins)", async () => {
		const ctx = createTestContext(counters.schema);
		ctx.increment("balances", { holder: "SP1" }, { amount: 10n });
		ctx.increment("balances", { holder: "SP1" }, { amount: -3n });

		const rows = await ctx.rows("balances");
		expect(rows).toHaveLength(1);
		// The read-modify-write this replaces would have produced -3 here.
		expect(rows[0]?.amount).toBe(7n);
	});

	test("reads observe writes queued earlier in the same block", async () => {
		const ctx = createTestContext(counters.schema);
		ctx.insert("balances", { holder: "SP2", amount: 5n });
		const found = await ctx.findOne("balances", { holder: "SP2" });
		expect(found?.amount).toBe(5n);
	});

	test("commit() materializes a block, and the next block reads it back", async () => {
		const ctx = createTestContext(counters.schema);
		ctx.increment("balances", { holder: "SP3" }, { amount: 4n });
		await ctx.commit();

		// New block: the committed row is the DB state the overlay builds on.
		ctx.increment("balances", { holder: "SP3" }, { amount: 6n });
		const rows = await ctx.rows("balances");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.amount).toBe(10n);
	});

	test("writing an unknown table is a compile error AND a runtime throw", () => {
		const ctx = createTestContext(counters.schema);
		// The typed context rejects it at compile time (that's the point of
		// hoisting the schema); the runtime guard is the backstop for
		// dynamically-built table names.
		// @ts-expect-error — "nope" is not a table in this schema
		expect(() => ctx.insert("nope", { a: 1 })).toThrow();
	});
});
