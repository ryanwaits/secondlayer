import { describe, expect, test } from "bun:test";
import { runHandlers } from "../src/runtime/runner.ts";
import type { MatchedTx } from "../src/runtime/source-matcher.ts";
import type { SubgraphDefinition, SubgraphFilter } from "../src/types.ts";

// Minimal mock context that tracks calls
function mockCtx() {
	const calls: { method: string; args: unknown[] }[] = [];
	return {
		calls,
		block: { height: 100, hash: "0x", timestamp: 0, burnBlockHeight: 0 },
		tx: { txId: "", sender: "", type: "", status: "" },
		setTx(tx: any) {
			this.tx = tx;
		},
		insert(table: string, row: any) {
			calls.push({ method: "insert", args: [table, row] });
		},
		update(table: string, where: any, set: any) {
			calls.push({ method: "update", args: [table, where, set] });
		},
		delete(table: string, where: any) {
			calls.push({ method: "delete", args: [table, where] });
		},
		pendingOps: 0,
		async flush() {
			return 0;
		},
	};
}

const sources: Record<string, SubgraphFilter> = {
	transfer: { type: "ft_transfer", assetIdentifier: "SP::c::token" },
};

const matched: MatchedTx[] = [
	{
		tx: {
			tx_id: "tx1",
			type: "contract_call",
			sender: "SP1",
			status: "success",
			contract_id: "SP::c",
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
					asset_identifier: "SP::c::token",
				},
			},
			{
				id: "e2",
				tx_id: "tx1",
				type: "ft_transfer_event",
				event_index: 1,
				data: {
					sender: "SP1",
					recipient: "SP3",
					amount: "2000",
					asset_identifier: "SP::c::token",
				},
			},
		],
		sourceName: "transfer",
	},
];

function makeSg(
	handlers: Record<string, any>,
	srcs?: Record<string, SubgraphFilter>,
): SubgraphDefinition {
	return {
		name: "test",
		sources: (srcs ?? sources) as any,
		schema: { data: { columns: { x: { type: "text" } } } },
		handlers,
	};
}

describe("runHandlers", () => {
	test("calls handler for each event", async () => {
		let callCount = 0;
		const sg = makeSg({ transfer: () => { callCount++; } });
		const ctx = mockCtx();
		const result = await runHandlers(sg, matched, ctx as any);
		expect(callCount).toBe(2);
		expect(result.processed).toBe(2);
		expect(result.errors).toBe(0);
	});

	test("falls back to catch-all handler", async () => {
		let callCount = 0;
		const sg = makeSg({ "*": () => { callCount++; } });
		const ctx = mockCtx();
		await runHandlers(sg, matched, ctx as any);
		expect(callCount).toBe(2);
	});

	test("skips when no matching handler", async () => {
		const sg = makeSg({ other: () => {} });
		const ctx = mockCtx();
		const result = await runHandlers(sg, matched, ctx as any);
		expect(result.processed).toBe(0);
	});

	test("sets tx context per matched tx", async () => {
		const seenTxIds: string[] = [];
		const sg = makeSg({
			transfer: (_event: any, ctx: any) => {
				seenTxIds.push(ctx.tx.txId);
			},
		});
		const ctx = mockCtx();
		await runHandlers(sg, matched, ctx as any);
		expect(seenTxIds).toEqual(["tx1", "tx1"]);
	});

	test("catches handler errors and continues", async () => {
		let callCount = 0;
		const sg = makeSg({
			transfer: () => {
				callCount++;
				if (callCount === 1) throw new Error("fail");
			},
		});
		const ctx = mockCtx();
		const result = await runHandlers(sg, matched, ctx as any);
		expect(callCount).toBe(2);
		expect(result.processed).toBe(1);
		expect(result.errors).toBe(1);
	});

	test("stops at error threshold", async () => {
		let callCount = 0;
		const sg = makeSg({
			transfer: () => {
				callCount++;
				throw new Error("always fail");
			},
		});

		const manyEvents: MatchedTx[] = [
			{
				tx: {
					tx_id: "tx1",
					type: "contract_call",
					sender: "SP1",
					status: "success",
				},
				events: Array.from({ length: 10 }, (_, i) => ({
					id: `e${i}`,
					tx_id: "tx1",
					type: "ft_transfer_event",
					event_index: i,
					data: { sender: "SP1", recipient: "SP2", amount: "100", asset_identifier: "SP::c::token" },
				})),
				sourceName: "transfer",
			},
		];

		const ctx = mockCtx();
		const result = await runHandlers(sg, manyEvents, ctx as any, {
			errorThreshold: 3,
		});
		expect(result.errors).toBe(3);
		expect(callCount).toBe(3);
	});

	test("builds typed ft_transfer payload", async () => {
		const received: Record<string, unknown>[] = [];
		const sg = makeSg({
			transfer: (event: any) => { received.push(event); },
		});
		const ctx = mockCtx();
		await runHandlers(sg, matched, ctx as any);
		expect(received.length).toBe(2);
		expect(received[0]!.sender).toBe("SP1");
		expect(received[0]!.recipient).toBe("SP2");
		expect(received[0]!.amount).toBe("1000");
		expect(received[0]!.assetIdentifier).toBe("SP::c::token");
		expect((received[0]!.tx as any).txId).toBe("tx1");
		// Second event
		expect(received[1]!.recipient).toBe("SP3");
		expect(received[1]!.amount).toBe("2000");
	});

	test("calls handler with tx-level data when no events", async () => {
		let received: Record<string, unknown> | null = null;
		const callSources: Record<string, SubgraphFilter> = {
			call: { type: "contract_call", contractId: "SP::c" },
		};
		const sg = makeSg({ call: (event: any) => { received = event; } }, callSources);

		const noEvents: MatchedTx[] = [
			{
				tx: {
					tx_id: "tx1",
					type: "contract_call",
					sender: "SP1",
					status: "success",
					contract_id: "SP::c",
					function_name: "swap",
				},
				events: [],
				sourceName: "call",
			},
		];

		const ctx = mockCtx();
		await runHandlers(sg, noEvents, ctx as any);
		expect(received).not.toBeNull();
		expect((received as any).tx.txId).toBe("tx1");
		expect((received as any).contractId).toBe("SP::c");
		expect((received as any).functionName).toBe("swap");
	});

	test("builds contract_deploy payload", async () => {
		let received: Record<string, unknown> | null = null;
		const deploySources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy" },
		};
		const sg = makeSg({ deploy: (event: any) => { received = event; } }, deploySources);

		const deployMatch: MatchedTx[] = [
			{
				tx: {
					tx_id: "tx4",
					type: "smart_contract",
					sender: "SP4",
					status: "success",
					contract_id: "SP4.my-contract",
				},
				events: [],
				sourceName: "deploy",
			},
		];

		const ctx = mockCtx();
		await runHandlers(sg, deployMatch, ctx as any);
		expect(received).not.toBeNull();
		expect((received as any).contractId).toBe("SP4.my-contract");
		expect((received as any).deployer).toBe("SP4");
	});

	test("populates contractId and functionName on ctx.tx", async () => {
		let seenContractId: string | null = null;
		let seenFunctionName: string | null = null;
		const sg = makeSg({
			transfer: (_event: any, ctx: any) => {
				seenContractId = ctx.tx.contractId;
				seenFunctionName = ctx.tx.functionName;
			},
		});
		const ctx = mockCtx();
		await runHandlers(sg, matched, ctx as any);
		expect(seenContractId).toBe("SP::c");
		expect(seenFunctionName).toBe("transfer");
	});
});
