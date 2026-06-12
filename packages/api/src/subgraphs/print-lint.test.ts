import { describe, expect, test } from "bun:test";
import type {
	InferredTopicSchema,
	SubgraphDefinition,
} from "@secondlayer/subgraphs";
import { lintPrintFields } from "./print-lint.ts";

const CONTRACT = "SP123.print-demo";

function topicSchema(topic: string, camelNames: string[]): InferredTopicSchema {
	return {
		topic,
		count: camelNames.length,
		first_height: 1,
		last_height: 2,
		non_tuple: false,
		fields: camelNames.map((camel) => ({
			name: camel,
			camel_name: camel,
			clarity_type: "uint",
			ts_type: "bigint",
			column_type: "uint",
			always_present: true,
		})),
	};
}

function lookupOf(topics: InferredTopicSchema[]) {
	return async () => ({ topics });
}

type LintDef = Pick<SubgraphDefinition, "sources" | "handlers">;

function defOf(
	sources: Record<string, Record<string, unknown>>,
	handlers: Record<string, (e: { data: Record<string, unknown> }) => unknown>,
): LintDef {
	return { sources, handlers } as unknown as LintDef;
}

describe("lintPrintFields", () => {
	const depositTopics = [
		topicSchema("completed-deposit", ["amount", "bitcoinTxid"]),
		topicSchema("withdrawal", ["recipient"]),
	];

	test("warns on a field never observed for the source's topic", async () => {
		const def = defOf(
			{
				deposits: {
					type: "print_event",
					contractId: CONTRACT,
					topic: "completed-deposit",
				},
			},
			{
				deposits: (e: { data: Record<string, unknown> }) =>
					e.data.amount && e.data.bogusField,
			},
		);
		const warnings = await lintPrintFields(def, lookupOf(depositTopics));
		expect(warnings).toEqual([
			`print_event source "deposits": field "bogusField" never observed on topic(s) completed-deposit of ${CONTRACT}`,
		]);
	});

	test("known fields and the topic discriminant produce no warnings", async () => {
		const def = defOf(
			{
				deposits: {
					type: "print_event",
					contractId: CONTRACT,
					topic: "completed-deposit",
				},
			},
			{
				deposits: (e: { data: Record<string, unknown> }) =>
					e.data.topic && e.data.amount && e.data.bitcoinTxid,
			},
		);
		expect(await lintPrintFields(def, lookupOf(depositTopics))).toEqual([]);
	});

	test("topicless source lints against the union of all observed topics", async () => {
		const def = defOf(
			{ prints: { type: "print_event", contractId: CONTRACT } },
			{
				prints: (e: { data: Record<string, unknown> }) =>
					e.data.recipient && e.data.nope,
			},
		);
		const warnings = await lintPrintFields(def, lookupOf(depositTopics));
		expect(warnings).toEqual([
			`print_event source "prints": field "nope" never observed on topic(s) completed-deposit, withdrawal of ${CONTRACT}`,
		]);
	});

	test("field observed only on another topic still warns when topic pinned", async () => {
		const def = defOf(
			{
				deposits: {
					type: "print_event",
					contractId: CONTRACT,
					topic: "completed-deposit",
				},
			},
			{
				// recipient exists on "withdrawal", not on the pinned topic
				deposits: (e: { data: Record<string, unknown> }) => e.data.recipient,
			},
		);
		const warnings = await lintPrintFields(def, lookupOf(depositTopics));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('"recipient"');
	});

	test("falls back to the wildcard handler when no named handler", async () => {
		const def = defOf(
			{
				deposits: {
					type: "print_event",
					contractId: CONTRACT,
					topic: "completed-deposit",
				},
			},
			{ "*": (e: { data: Record<string, unknown> }) => e.data.bogusField },
		);
		expect(await lintPrintFields(def, lookupOf(depositTopics))).toHaveLength(1);
	});

	test("repeated unknown reads warn once", async () => {
		const def = defOf(
			{ prints: { type: "print_event", contractId: CONTRACT } },
			{
				prints: (e: { data: Record<string, unknown> }) =>
					e.data.nope && e.data.nope && e.data.nope,
			},
		);
		expect(await lintPrintFields(def, lookupOf(depositTopics))).toHaveLength(1);
	});

	test("skips trait, unpinned, and non-print sources", async () => {
		const handler = (e: { data: Record<string, unknown> }) => e.data.bogus;
		const def = defOf(
			{
				traited: {
					type: "print_event",
					contractId: CONTRACT,
					trait: "SP2X.trait.trait",
				},
				unpinned: { type: "print_event" },
				calls: { type: "contract_call", contractId: CONTRACT },
			},
			{ traited: handler, unpinned: handler, calls: handler },
		);
		expect(await lintPrintFields(def, lookupOf(depositTopics))).toEqual([]);
	});

	test("skips when the declared topic was never observed", async () => {
		const def = defOf(
			{
				ghosts: {
					type: "print_event",
					contractId: CONTRACT,
					topic: "never-seen",
				},
			},
			{ ghosts: (e: { data: Record<string, unknown> }) => e.data.bogus },
		);
		expect(await lintPrintFields(def, lookupOf(depositTopics))).toEqual([]);
	});

	test("skips when no topics observed or the lookup throws", async () => {
		const def = defOf(
			{ prints: { type: "print_event", contractId: CONTRACT } },
			{ prints: (e: { data: Record<string, unknown> }) => e.data.bogus },
		);
		expect(await lintPrintFields(def, lookupOf([]))).toEqual([]);
		expect(
			await lintPrintFields(def, async () => {
				throw new Error("schema source down");
			}),
		).toEqual([]);
	});
});
