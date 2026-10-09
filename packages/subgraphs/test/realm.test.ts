import { describe, expect, test } from "bun:test";
import {
	HandlerReadError,
	NondeterminismError,
	loadDeterministicDefinition,
} from "../src/runtime/realm.ts";
import { runHandlers } from "../src/runtime/runner.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";
import { createTestContext } from "../src/testing/harness.ts";
import type { SubgraphDefinition, SubgraphSchema } from "../src/types.ts";

const schema = {
	rows: {
		columns: { k: { type: "text" }, v: { type: "jsonb", nullable: true } },
		uniqueKeys: [["k"]],
	},
} satisfies SubgraphSchema;

/** Bundled-handler shape, as esbuild emits it into `handler_code`. */
const handlerCode = (body: string, prelude = "") => `
function defineSubgraph(d) { return d; }
${prelude}
var subgraph_default = defineSubgraph({
	name: "realm-test",
	sources: { transfer: { type: "ft_transfer" } },
	schema: ${JSON.stringify(schema)},
	handlers: { transfer: async (event, ctx) => { ${body} } },
});
export { subgraph_default as default };
`;

async function run(body: string, prelude?: string) {
	const def = await loadDeterministicDefinition(handlerCode(body, prelude));
	const ctx = createTestContext(schema);
	const handler = def.handlers.transfer;
	if (!handler) throw new Error("no handler");
	await handler({ amount: 5n, bytes: new Uint8Array([1, 2]) }, ctx as never);
	return ctx.rows("rows");
}

describe("deterministic realm blocks nondeterministic globals at runtime", () => {
	for (const [label, body] of [
		["Date", "Date.now();"],
		["Math.random", "Math.random();"],
		["Math.sin (engine-approximated)", "Math.sin(1);"],
		["fetch", 'await fetch("https://example.com");'],
		["setTimeout", "setTimeout(() => {}, 1);"],
		["Intl", "new Intl.NumberFormat();"],
		["locale method", "(1234).toLocaleString();"],
		["process", "process.env.HOME;"],
		["eval", 'eval("1");'],
		["ctx.client", 'ctx.client.readOnly("SP1.c", "f");'],
	] as const) {
		test(label, async () => {
			await expect(run(body)).rejects.toBeInstanceOf(NondeterminismError);
		});
	}

	test("module-level reads are caught too, at load", async () => {
		await expect(
			loadDeterministicDefinition(handlerCode("", "const BOOT = Date.now();")),
		).rejects.toBeInstanceOf(NondeterminismError);
	});

	test("code generation from strings is off", async () => {
		await expect(run('new Function("return 1")();')).rejects.toThrow(
			/Code generation/,
		);
	});

	test("handlers cannot add globals", async () => {
		await expect(run('"use strict"; globalThis.leak = 1;')).rejects.toThrow();
	});
});

describe("deterministic realm keeps spec-exact behavior", () => {
	test("bigint math, collections, JSON, exact Math and host byte arrays work", async () => {
		const rows = await run(`
			const m = new Map([["a", event.amount * 2n]]);
			const ok = event.bytes instanceof Uint8Array && new TextEncoder().encode("x") instanceof Uint8Array;
			ctx.insert("rows", {
				k: "a",
				v: { doubled: m.get("a"), max: Math.max(1, 7), ok, json: JSON.stringify([1, "b"]) },
			});
		`);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.v).toEqual({
			doubled: 10n,
			max: 7,
			ok: true,
			json: '[1,"b"]',
		});
	});
});

describe("ctx value check", () => {
	for (const [label, value] of [
		["non-integer number", "1.5"],
		["unsafe integer", "2 ** 60"],
		["NaN", "NaN"],
		["function", "() => 1"],
		["symbol", 'Symbol("s")'],
		["float nested in jsonb", "{ a: [1, { b: 0.1 }] }"],
	] as const) {
		test(`rejects ${label}`, async () => {
			await expect(
				run(`ctx.insert("rows", { k: "a", v: ${value} });`),
			).rejects.toBeInstanceOf(TypeError);
		});
	}

	test("rejects floats in upsert and increment too", async () => {
		await expect(
			run('ctx.upsert("rows", { k: "a" }, { v: 0.5 });'),
		).rejects.toBeInstanceOf(TypeError);
		await expect(
			run('ctx.increment("rows", { k: "a" }, { v: 1.5 });'),
		).rejects.toBeInstanceOf(TypeError);
	});

	test("accepts bigint, safe integers, strings, bytes and null", async () => {
		const rows = await run(
			'ctx.insert("rows", { k: "a", v: { n: 9007199254740991, b: 2n ** 70n, s: "x", bytes: event.bytes, none: null } });',
		);
		expect(rows).toHaveLength(1);
	});
});

describe("ctx reads", () => {
	test("sequential awaited reads are fine", async () => {
		const rows = await run(`
			const a = await ctx.findOne("rows", { k: "a" });
			const b = await ctx.findMany("rows", { k: "b" });
			ctx.insert("rows", { k: "c", v: { a: a === null, b: b.length } });
		`);
		expect(rows[0]?.v).toEqual({ a: true, b: 0 });
	});

	test("concurrent ctx calls are refused: their order follows database latency", async () => {
		await expect(
			run(`
				await Promise.all([
					ctx.findOne("rows", { k: "a" }),
					ctx.findOne("rows", { k: "b" }),
				]);
			`),
		).rejects.toBeInstanceOf(NondeterminismError);
	});

	test("a failed database read aborts instead of skipping", async () => {
		const def = await loadDeterministicDefinition(
			handlerCode('await ctx.findOne("rows", { k: "a" });'),
		);
		const ctx = createTestContext(schema);
		ctx.findOne = () => Promise.reject(new Error("connection reset"));
		await expect(
			def.handlers.transfer?.({}, ctx as never),
		).rejects.toBeInstanceOf(HandlerReadError);
	});

	test("an unknown table stays a handler error: identical on every run", async () => {
		const err = await run('await ctx.findOne("missing_table", {});').catch(
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(HandlerReadError);
	});
});

const matched: MatchedTx[] = [
	{
		tx: {
			tx_id: "tx1",
			type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_id: "SP1.c",
			function_name: "transfer",
		},
		events: [
			{
				id: "e1",
				tx_id: "tx1",
				type: "ft_transfer_event",
				event_index: 0,
				data: {
					sender: "SP1",
					recipient: "SP2",
					amount: "1000",
					asset_identifier: "SP1.c::t",
				},
			},
		],
		sourceName: "transfer",
	} as MatchedTx,
];

describe("runner", () => {
	test("a NondeterminismError aborts the block instead of counting an event error", async () => {
		const def = await loadDeterministicDefinition(
			handlerCode('ctx.insert("rows", { k: "a", v: { at: Date.now() } });'),
		);
		const ctx = createTestContext(schema);
		await expect(
			runHandlers(def, matched, ctx as never),
		).rejects.toBeInstanceOf(NondeterminismError);
	});

	test("subgraphs outside the realm keep today's path: Date works, throws are skipped", async () => {
		const plain: SubgraphDefinition = {
			name: "plain",
			sources: { transfer: { type: "ft_transfer" } },
			schema,
			handlers: {
				transfer: (_e, ctx) => {
					ctx.insert("rows", { k: "a", v: { at: Date.now() } });
				},
			},
		};
		const ctx = createTestContext(schema);
		const ok = await runHandlers(plain, matched, ctx as never);
		expect(ok).toMatchObject({ processed: 1, errors: 0 });

		const throwing: SubgraphDefinition = {
			...plain,
			handlers: {
				transfer: () => {
					throw new Error("handler bug");
				},
			},
		};
		const skipped = await runHandlers(
			throwing,
			matched,
			createTestContext(schema) as never,
		);
		expect(skipped).toMatchObject({ processed: 0, errors: 1 });
	});
});
