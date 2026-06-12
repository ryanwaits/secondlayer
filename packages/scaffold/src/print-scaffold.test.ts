import { describe, expect, test } from "bun:test";
import {
	type PrintScaffoldTopic,
	generatePrintSchemaSubgraph,
} from "./print-scaffold.ts";

const TOPICS: PrintScaffoldTopic[] = [
	{
		topic: "completed-deposit",
		non_tuple: false,
		fields: [
			{
				name: "amount",
				camel_name: "amount",
				column_type: "uint",
				always_present: true,
			},
			{
				name: "bitcoin-txid",
				camel_name: "bitcoinTxid",
				column_type: "text",
				always_present: true,
			},
		],
	},
	{
		topic: "withdrawal-create",
		non_tuple: false,
		fields: [
			{
				name: "amount",
				camel_name: "amount",
				column_type: "uint",
				always_present: true,
			},
			{
				name: "sender",
				camel_name: "sender",
				column_type: "principal",
				always_present: false,
			},
		],
	},
];

const CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry";

interface EvaluatedDef {
	name: string;
	sources: Record<
		string,
		{
			type: string;
			contractId: string;
			topic?: string;
			prints?: Record<string, Record<string, string>>;
		}
	>;
	schema: Record<
		string,
		{
			columns: Record<
				string,
				{ type: string; nullable?: boolean; indexed?: boolean }
			>;
		}
	>;
	handlers: Record<
		string,
		(
			event: { data: Record<string, unknown>; topic?: string },
			ctx: { insert: (table: string, row: Record<string, unknown>) => void },
		) => void
	>;
}

/** Executes the generated module — proves the emitted code is syntactically valid JS. */
function evalScaffold(out: string): EvaluatedDef {
	const body = out
		.replace(/^import[^\n]*\n/, "")
		.replace("export default ", "return ");
	return new Function("defineSubgraph", body)(
		(def: EvaluatedDef) => def,
	) as EvaluatedDef;
}

describe("generatePrintSchemaSubgraph", () => {
	test("wide table: one source per topic with prints map", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: TOPICS,
		});
		expect(out).toContain("name: 'sbtc-registry'");
		expect(out).toContain("completedDeposit: {");
		expect(out).toContain("withdrawalCreate: {");
		expect(out).toContain("type: 'print_event'");
		expect(out).toContain(`contractId: '${CONTRACT}'`);
		expect(out).toContain("topic: 'completed-deposit'");
		// prints map keyed by topic, fields by camel_name → column_type
		expect(out).toContain("'completed-deposit': {");
		expect(out).toContain("bitcoinTxid: 'text'");
		expect(out).toContain("amount: 'uint'");
	});

	test("wide table: union columns, nullability + per-topic comments", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: TOPICS,
		});
		expect(out).toContain("sbtc_registry: {");
		expect(out).toContain("topic: { type: 'text', indexed: true }");
		// amount: always_present on every topic → not nullable, no comment
		expect(out).toContain("amount: { type: 'uint' }");
		expect(out).not.toContain("amount: { type: 'uint', nullable: true }");
		// bitcoin_txid only on completed-deposit → nullable + comment
		expect(out).toContain(
			"bitcoin_txid: { type: 'text', nullable: true }, // null except on topics: completed-deposit",
		);
		// sender on one topic and not always present → nullable + comment
		expect(out).toContain(
			"sender: { type: 'principal', nullable: true } // null except on topics: withdrawal-create",
		);
	});

	test("wide table: handlers insert their topic's fields + discriminant", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: TOPICS,
		});
		expect(out).toContain(
			"ctx.insert('sbtc_registry', { topic: 'completed-deposit', amount: event.data.amount, bitcoin_txid: event.data.bitcoinTxid });",
		);
		expect(out).toContain(
			"ctx.insert('sbtc_registry', { topic: 'withdrawal-create', amount: event.data.amount, sender: event.data.sender });",
		);
	});

	test("tablePerTopic: one table per topic, only its columns", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: TOPICS,
			tablePerTopic: true,
		});
		expect(out).toContain("completed_deposit: {");
		expect(out).toContain("withdrawal_create: {");
		// always_present → not nullable; optional → nullable
		expect(out).toContain("bitcoin_txid: { type: 'text' }");
		expect(out).toContain("sender: { type: 'principal', nullable: true }");
		// no topic discriminant column/insert in per-topic layout
		expect(out).not.toContain("topic: { type: 'text'");
		expect(out).toContain(
			"ctx.insert('completed_deposit', { amount: event.data.amount, bitcoin_txid: event.data.bitcoinTxid });",
		);
	});

	test("name override", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			name: "sbtc-flows",
			topics: TOPICS,
		});
		expect(out).toContain("name: 'sbtc-flows'");
	});

	test("'*' pseudo-topic is skipped when named topics exist", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: [...TOPICS, { topic: "*", non_tuple: true, fields: [] }],
		});
		expect(out).not.toContain("'*'");
		expect(out).toContain("completedDeposit: {");
	});

	test("'*'-only contract → generic jsonb scaffold", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: [{ topic: "*", non_tuple: true, fields: [] }],
		});
		expect(out).toContain(
			`events: { type: 'print_event', contractId: '${CONTRACT}' }`,
		);
		expect(out).toContain("value: { type: 'jsonb', nullable: true }");
		expect(out).not.toContain("prints:");
	});

	test("conflicting column types across topics → jsonb wide column", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: [
				{
					topic: "a",
					fields: [
						{
							name: "value",
							camel_name: "value",
							column_type: "uint",
							always_present: true,
						},
					],
				},
				{
					topic: "b",
					fields: [
						{
							name: "value",
							camel_name: "value",
							column_type: "text",
							always_present: true,
						},
					],
				},
			],
		});
		expect(out).toContain("value: { type: 'jsonb' }");
	});

	test("rejects empty topics", () => {
		expect(() =>
			generatePrintSchemaSubgraph({ contractId: CONTRACT, topics: [] }),
		).toThrow();
	});

	test("hyphenated topic keys are quoted and output evaluates as valid JS", () => {
		const out = generatePrintSchemaSubgraph({
			contractId: CONTRACT,
			topics: TOPICS,
		});
		expect(out).toContain("'completed-deposit': {");
		expect(out).toContain("'withdrawal-create': {");
		const def = evalScaffold(out);
		expect(def.sources.completedDeposit?.prints?.["completed-deposit"]).toEqual(
			{ amount: "uint", bitcoinTxid: "text" },
		);
		expect(def.sources.withdrawalCreate?.topic).toBe("withdrawal-create");
	});

	test("quotes/backslashes/newlines in chain strings are escaped, both layouts", () => {
		const topic = `it's a "weird"\\\ntopic`;
		const topics: PrintScaffoldTopic[] = [
			{
				topic,
				fields: [
					{
						name: "bad'field",
						camel_name: "bad'field",
						column_type: "uint",
						always_present: true,
					},
				],
			},
			{
				topic: "plain",
				fields: [
					{
						name: "ok",
						camel_name: "ok",
						column_type: "text",
						always_present: true,
					},
				],
			},
		];
		for (const tablePerTopic of [false, true]) {
			const out = generatePrintSchemaSubgraph({
				contractId: CONTRACT,
				topics,
				tablePerTopic,
			});
			const def = evalScaffold(out);
			const weird = Object.values(def.sources).find((s) => s.topic === topic);
			expect(weird).toBeDefined();
			expect(weird?.prints?.[topic]?.["bad'field"]).toBe("uint");
		}
		// Wide layout: weird topic also lands in a `// null except on topics:` comment
		// and the handler row — evalScaffold above already proves neither broke syntax.
		const wide = evalScaffold(
			generatePrintSchemaSubgraph({ contractId: CONTRACT, topics }),
		);
		const handlerKey = Object.keys(wide.handlers)[0] as string;
		const rows: Array<[string, Record<string, unknown>]> = [];
		wide.handlers[handlerKey]?.(
			{ data: { "bad'field": 1n } },
			{ insert: (t, r) => rows.push([t, r]) },
		);
		expect(rows[0]?.[1]?.topic).toBe(topic);
		expect(rows[0]?.[1]?.["bad'field"]).toBe(1n);
	});

	test("topics that camelize identically get suffixed source keys", () => {
		const collide: PrintScaffoldTopic[] = [
			{ topic: "fee-set", fields: [] },
			{ topic: "feeSet", fields: [] },
		];
		const def = evalScaffold(
			generatePrintSchemaSubgraph({ contractId: CONTRACT, topics: collide }),
		);
		expect(Object.keys(def.sources)).toEqual(["feeSet", "feeSet_2"]);
		expect(Object.keys(def.handlers)).toEqual(["feeSet", "feeSet_2"]);
		expect(def.sources.feeSet?.topic).toBe("fee-set");
		expect(def.sources.feeSet_2?.topic).toBe("feeSet");
	});

	test("tablePerTopic: colliding table names get suffixed, handlers follow", () => {
		const collide: PrintScaffoldTopic[] = [
			{ topic: "fee-set", fields: [] },
			{ topic: "fee_set", fields: [] },
		];
		const def = evalScaffold(
			generatePrintSchemaSubgraph({
				contractId: CONTRACT,
				topics: collide,
				tablePerTopic: true,
			}),
		);
		expect(Object.keys(def.schema)).toEqual(["fee_set", "fee_set_2"]);
		const tables: string[] = [];
		for (const h of Object.values(def.handlers)) {
			h({ data: {} }, { insert: (t) => tables.push(t) });
		}
		expect(tables).toEqual(["fee_set", "fee_set_2"]);
	});

	test("different fields with colliding snake names get suffixed columns", () => {
		const topics: PrintScaffoldTopic[] = [
			{
				topic: "swap",
				fields: [
					{
						name: "foo-bar",
						camel_name: "fooBar",
						column_type: "uint",
						always_present: true,
					},
					{
						name: "foo_bar",
						camel_name: "foo_bar",
						column_type: "text",
						always_present: true,
					},
				],
			},
		];
		for (const tablePerTopic of [false, true]) {
			const def = evalScaffold(
				generatePrintSchemaSubgraph({
					contractId: CONTRACT,
					topics,
					tablePerTopic,
				}),
			);
			const table = Object.values(def.schema)[0];
			expect(table?.columns.foo_bar?.type).toBe("uint");
			expect(table?.columns.foo_bar_2?.type).toBe("text");
			// handler maps each event.data key to its own (suffixed) column
			const rows: Array<Record<string, unknown>> = [];
			def.handlers.swap?.(
				{ data: { fooBar: 7n, foo_bar: "x" } },
				{ insert: (_t, r) => rows.push(r) },
			);
			expect(rows[0]?.foo_bar).toBe(7n);
			expect(rows[0]?.foo_bar_2).toBe("x");
		}
	});

	test("same camel field across topics stays one union column (no suffix)", () => {
		const def = evalScaffold(
			generatePrintSchemaSubgraph({ contractId: CONTRACT, topics: TOPICS }),
		);
		const cols = def.schema.sbtc_registry?.columns ?? {};
		expect(cols.amount?.type).toBe("uint");
		expect(cols).not.toHaveProperty("amount_2");
	});

	test("field snake-colliding with the topic discriminant gets suffixed", () => {
		const topics: PrintScaffoldTopic[] = [
			{
				topic: "a",
				fields: [
					{
						// runtime strips `topic` from data, but defend against any
						// field whose snake form shadows the discriminant column
						name: "topic",
						camel_name: "topic",
						column_type: "text",
						always_present: true,
					},
				],
			},
			{ topic: "b", fields: [] },
		];
		const def = evalScaffold(
			generatePrintSchemaSubgraph({ contractId: CONTRACT, topics }),
		);
		const cols = def.schema.sbtc_registry?.columns ?? {};
		expect(cols.topic?.indexed).toBe(true);
		expect(cols.topic_2?.type).toBe("text");
		const rows: Array<Record<string, unknown>> = [];
		def.handlers.a?.(
			{ data: { topic: "payload-topic" } },
			{ insert: (_t, r) => rows.push(r) },
		);
		expect(rows[0]?.topic).toBe("a");
		expect(rows[0]?.topic_2).toBe("payload-topic");
	});
});
