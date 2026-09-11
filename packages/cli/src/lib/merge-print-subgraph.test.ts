import { describe, expect, test } from "bun:test";
import { generatePrintSchemaSubgraph } from "@secondlayer/scaffold";
import { mergePrintSchemaIntoFile } from "./merge-print-subgraph.ts";

const TOPIC_A = [
	{
		topic: "completed-deposit",
		fields: [
			{
				name: "amount",
				camel_name: "amount",
				column_type: "uint",
				always_present: true,
			},
		],
	},
];

const TOPIC_B = [
	{
		topic: "swap",
		fields: [
			{
				name: "dx",
				camel_name: "dx",
				column_type: "uint",
				always_present: true,
			},
		],
	},
];

describe("mergePrintSchemaIntoFile", () => {
	test("file with one print source + add second contract → both contractIds", () => {
		const existing = generatePrintSchemaSubgraph({
			contractId: "SM3.sbtc-registry",
			name: "sbtc",
			topics: TOPIC_A,
		});
		const merged = mergePrintSchemaIntoFile(existing, {
			contractId: "SP1.amm-pool",
			topics: TOPIC_B,
		});
		expect(merged).toContain("contractId: 'SM3.sbtc-registry'");
		expect(merged).toContain("contractId: 'SP1.amm-pool'");
		expect(merged).toContain("topic: 'completed-deposit'");
		expect(merged).toContain("topic: 'swap'");
		expect(merged).toContain("name: 'sbtc'");
	});

	test("colliding source keys get suffixed", () => {
		const existing = generatePrintSchemaSubgraph({
			contractId: "SP1.a",
			name: "multi",
			topics: TOPIC_B,
		});
		const merged = mergePrintSchemaIntoFile(existing, {
			contractId: "SP2.b",
			topics: TOPIC_B,
		});
		expect(merged).toContain("swap:");
		expect(merged).toContain("swap_2:");
		expect(merged).toContain("contractId: 'SP1.a'");
		expect(merged).toContain("contractId: 'SP2.b'");
	});

	test("non-static file exits with clear error", () => {
		const bad = `
import { defineSubgraph } from '@secondlayer/subgraphs';
const sources = { x: { type: 'stx_transfer' } };
export default defineSubgraph({ name: 'bad', sources, schema: { t: { columns: { a: { type: 'text' } } } }, handlers: {} });
`;
		expect(() =>
			mergePrintSchemaIntoFile(bad, {
				contractId: "SP1.x",
				topics: TOPIC_B,
			}),
		).toThrow(/cannot merge/);
	});
});
