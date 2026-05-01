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
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		setTx(tx: any) {
			this.tx = tx;
		},
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		insert(table: string, row: any) {
			calls.push({ method: "insert", args: [table, row] });
		},
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		update(table: string, where: any, set: any) {
			calls.push({ method: "update", args: [table, where, set] });
		},
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
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
	// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
	handlers: Record<string, any>,
	srcs?: Record<string, SubgraphFilter>,
): SubgraphDefinition {
	return {
		name: "test",
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		sources: (srcs ?? sources) as any,
		schema: { data: { columns: { x: { type: "text" } } } },
		handlers,
	};
}

describe("runHandlers", () => {
	test("calls handler for each event", async () => {
		let callCount = 0;
		const sg = makeSg({
			transfer: () => {
				callCount++;
			},
		});
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		const result = await runHandlers(sg, matched, ctx as any);
		expect(callCount).toBe(2);
		expect(result.processed).toBe(2);
		expect(result.errors).toBe(0);
	});

	test("falls back to catch-all handler", async () => {
		let callCount = 0;
		const sg = makeSg({
			"*": () => {
				callCount++;
			},
		});
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, matched, ctx as any);
		expect(callCount).toBe(2);
	});

	test("skips when no matching handler", async () => {
		const sg = makeSg({ other: () => {} });
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		const result = await runHandlers(sg, matched, ctx as any);
		expect(result.processed).toBe(0);
	});

	test("sets tx context per matched tx", async () => {
		const seenTxIds: string[] = [];
		const sg = makeSg({
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			transfer: (_event: any, ctx: any) => {
				seenTxIds.push(ctx.tx.txId);
			},
		});
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, matched, ctx as any);
		expect(seenTxIds).toEqual(["tx1", "tx1"]);
	});

	test("uses raw_value for indexed contract_event print payloads", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		let seen: any;
		const sg = makeSg(
			{
				// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
				print: (event: any) => {
					seen = event;
				},
			},
			{
				print: {
					type: "print_event",
					contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
				},
			},
		);
		const ctx = mockCtx();
		const result = await runHandlers(
			sg,
			[
				{
					tx: {
						tx_id:
							"0xbfd1bbdaddc9a1ce8e91c799dade596a7253c0257a27586798164a6b6c4a8c90",
						type: "contract_call",
						sender: "SM9C599D8ZY6KN2F4W1VD041RQ4X3M585CY7QKNF",
						status: "success",
						contract_id:
							"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
						function_name: "complete-deposit-wrapper",
					},
					events: [
						{
							id: "e1",
							tx_id:
								"0xbfd1bbdaddc9a1ce8e91c799dade596a7253c0257a27586798164a6b6c4a8c90",
							type: "contract_event",
							event_index: 1,
							data: {
								topic: "print",
								value: {
									Tuple: {
										data_map: {
											topic: {
												Sequence: {
													String: {
														ASCII: {
															data: [
																99, 111, 109, 112, 108, 101, 116, 101, 100, 45,
																100, 101, 112, 111, 115, 105, 116,
															],
														},
													},
												},
											},
										},
									},
								},
								raw_value:
									"0x0c0000000706616d6f756e74010000000000000000000000000000737c0c626974636f696e2d747869640200000020f87818576eb7792900db76f81fde0c07122176ce8029bea50abfefe7327c8fc4096275726e2d686173680200000020000000000000000000015d5a7280c3c9009a3b6e07ffcf6521a0bd6d4b9b1f780b6275726e2d68656967687401000000000000000000000000000e71600c6f75747075742d696e64657801000000000000000000000000000000000a73776565702d74786964020000002043d56d48e00d41e20c3dc0f5cd48f0294921f4a02fafcb77b4024d7b9ea45ea505746f7069630d00000011636f6d706c657465642d6465706f736974",
								contract_identifier:
									"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
							},
						},
					],
					sourceName: "print",
				},
			],
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			ctx as any,
		);

		expect(result.errors).toBe(0);
		expect(result.processed).toBe(1);
		expect(seen.topic).toBe("completed-deposit");
		expect(seen.data.bitcoinTxid).toBe(
			"0xf87818576eb7792900db76f81fde0c07122176ce8029bea50abfefe7327c8fc4",
		);
		expect(seen.data.outputIndex).toBe(0n);
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
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
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
					data: {
						sender: "SP1",
						recipient: "SP2",
						amount: "100",
						asset_identifier: "SP::c::token",
					},
				})),
				sourceName: "transfer",
			},
		];

		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		const result = await runHandlers(sg, manyEvents, ctx as any, {
			errorThreshold: 3,
		});
		expect(result.errors).toBe(3);
		expect(callCount).toBe(3);
	});

	test("builds typed ft_transfer payload", async () => {
		const received: Record<string, unknown>[] = [];
		const sg = makeSg({
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			transfer: (event: any) => {
				received.push(event);
			},
		});
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, matched, ctx as any);
		expect(received.length).toBe(2);
		expect(received[0]?.sender).toBe("SP1");
		expect(received[0]?.recipient).toBe("SP2");
		expect(received[0]?.amount).toBe(1000n);
		expect(received[0]?.assetIdentifier).toBe("SP::c::token");
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received[0]?.tx as any).txId).toBe("tx1");
		// Second event
		expect(received[1]?.recipient).toBe("SP3");
		expect(received[1]?.amount).toBe(2000n);
	});

	test("calls handler with tx-level data when no events", async () => {
		let received: Record<string, unknown> | null = null;
		const callSources: Record<string, SubgraphFilter> = {
			call: { type: "contract_call", contractId: "SP::c" },
		};
		const sg = makeSg(
			{
				// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
				call: (event: any) => {
					received = event;
				},
			},
			callSources,
		);

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
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, noEvents, ctx as any);
		expect(received).not.toBeNull();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received as any).tx.txId).toBe("tx1");
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received as any).contractId).toBe("SP::c");
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received as any).functionName).toBe("swap");
	});

	test("builds contract_deploy payload", async () => {
		let received: Record<string, unknown> | null = null;
		const deploySources: Record<string, SubgraphFilter> = {
			deploy: { type: "contract_deploy" },
		};
		const sg = makeSg(
			{
				// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
				deploy: (event: any) => {
					received = event;
				},
			},
			deploySources,
		);

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
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, deployMatch, ctx as any);
		expect(received).not.toBeNull();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received as any).contractId).toBe("SP4.my-contract");
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((received as any).deployer).toBe("SP4");
	});

	test("populates contractId and functionName on ctx.tx", async () => {
		let seenContractId: string | null = null;
		let seenFunctionName: string | null = null;
		const sg = makeSg({
			// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
			transfer: (_event: any, ctx: any) => {
				seenContractId = ctx.tx.contractId;
				seenFunctionName = ctx.tx.functionName;
			},
		});
		const ctx = mockCtx();
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		await runHandlers(sg, matched, ctx as any);
		expect(seenContractId).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		expect(seenContractId!).toBe("SP::c");
		expect(seenFunctionName).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		expect(seenFunctionName!).toBe("transfer");
	});
});
