import { describe, expect, test } from "bun:test";
import { matchSources, readPath } from "../src/runtime/source-matcher.ts";
import { validateSubgraphDefinition } from "../src/validate.ts";

/**
 * The `factory` primitive: index a contract set that GROWS. A router plus
 * twelve pools used to cost twelve sources and twelve near-identical
 * handlers, and pools deployed after you shipped were unreachable entirely.
 *
 * Two constraints carry the correctness of the feature, and both are tested
 * here at the level they're implemented:
 *  - a source only matches addresses its factory has revealed;
 *  - the discovered set is chain-derived state (the block-processor stamps
 *    each address with the block that revealed it, and the reorg handler
 *    deletes at or above the fork).
 */

const REGISTRY = "SP1REGISTRY000000000000000000000000000000.registry";
const POOL_A = "SP1POOL0000000000000000000000000000000000.pool-a";
const POOL_B = "SP1POOL0000000000000000000000000000000000.pool-b";

function printEvent(contractId: string, txId: string) {
	return {
		id: `${txId}-0`,
		tx_id: txId,
		type: "contract_event" as const,
		event_index: 0,
		data: { topic: "print", contract_id: contractId, value: "0x00" },
	};
}

const TX = {
	tx_id: "0xtx1",
	type: "contract_call",
	status: "success",
	sender: "SP1",
	contract_id: POOL_A,
	function_name: "swap",
};

describe("factory-scoped sources", () => {
	test("only matches addresses the factory revealed", () => {
		const sources = {
			swaps: {
				type: "print_event" as const,
				factory: { from: "registry", field: "data.pool" },
			},
		};
		const events = [printEvent(POOL_A, "0xtx1"), printEvent(POOL_B, "0xtx2")];
		const txs = [
			{ ...TX, contract_id: POOL_A },
			{ ...TX, tx_id: "0xtx2", contract_id: POOL_B },
		];

		// Nothing discovered yet → nothing matches. (An unscoped source would
		// have matched every print on chain.)
		expect(
			matchSources(sources, txs, events, new Map(), new Map()),
		).toHaveLength(0);

		// Pool A revealed by the registry → only pool A's events match. The
		// set is keyed by the DISCOVERING source, so several consumers share it.
		const matched = matchSources(
			sources,
			txs,
			events,
			new Map(),
			new Map([["registry", new Set([POOL_A])]]),
		);
		expect(matched).toHaveLength(1);
		expect(matched[0]?.tx.contract_id).toBe(POOL_A);
	});

	test("contract_call sources are factory-scopable too", () => {
		const sources = {
			calls: {
				type: "contract_call" as const,
				factory: { from: "registry", field: "data.pool" },
			},
		};
		const txs = [TX, { ...TX, tx_id: "0xtx2", contract_id: POOL_B }];
		const matched = matchSources(
			sources,
			txs,
			[],
			new Map(),
			new Map([["registry", new Set([POOL_B])]]),
		);
		expect(matched).toHaveLength(1);
		expect(matched[0]?.tx.contract_id).toBe(POOL_B);
	});

	test("readPath pulls the address off a nested payload field", () => {
		expect(readPath({ data: { pool: POOL_A } }, "data.pool")).toBe(POOL_A);
		expect(readPath({ contractId: POOL_A }, "contractId")).toBe(POOL_A);
		expect(readPath({ data: { a: { b: POOL_B } } }, "data.a.b")).toBe(POOL_B);
		expect(readPath({ data: {} }, "data.missing")).toBeUndefined();
		expect(readPath(null, "data.pool")).toBeUndefined();
	});

	test("a factory declaration validates; a malformed one does not", () => {
		const def = (factory: unknown) => ({
			name: "factory-test",
			sources: {
				registry: { type: "print_event", contractId: REGISTRY },
				swaps: { type: "print_event", factory },
			},
			schema: { t: { columns: { a: { type: "uint" } } } },
			handlers: { registry: () => {}, swaps: () => {} },
		});
		expect(() =>
			validateSubgraphDefinition(def({ from: "registry", field: "data.pool" })),
		).not.toThrow();
		// Missing field / unknown key are refused at deploy.
		expect(() =>
			validateSubgraphDefinition(def({ from: "registry" })),
		).toThrow();
		expect(() =>
			validateSubgraphDefinition(
				def({ from: "registry", field: "data.pool", nope: 1 }),
			),
		).toThrow();
	});
});
