import { describe, expect, test } from "bun:test";
import type { SubgraphDefinition } from "../types.ts";
import {
	PublicApiBlockSource,
	canSparseScan,
	sparseProbeTargets,
} from "./block-source.ts";

const def = (sources: Record<string, unknown>) =>
	({ name: "t", sources, schema: {}, handlers: {} }) as SubgraphDefinition;

describe("sparse scan eligibility + probe targets", () => {
	test("event-only sources are eligible; tx sources are not", () => {
		expect(
			canSparseScan(
				def({ a: { type: "ft_transfer", assetIdentifier: "SP1.t::x" } }),
			),
		).toBe(true);
		expect(
			canSparseScan(def({ a: { type: "contract_call", contractId: "SP1.c" } })),
		).toBe(false);
		expect(canSparseScan(def({}))).toBe(false);
	});

	test("targets carry contract scope from assetIdentifier and dedupe", () => {
		const targets = sparseProbeTargets(
			def({
				transfer: { type: "ft_transfer", assetIdentifier: "SP1.token::tok" },
				mint: { type: "ft_mint", assetIdentifier: "SP1.token::tok" },
				dupe: { type: "ft_transfer", assetIdentifier: "SP1.token::tok" },
				open: { type: "print_event" },
			}),
		);
		expect(targets).toEqual(
			expect.arrayContaining([
				{ eventType: "ft_transfer", contractId: "SP1.token" },
				{ eventType: "ft_mint", contractId: "SP1.token" },
				{ eventType: "print" },
			]),
		);
		expect(targets).toHaveLength(3);
	});
});

describe("PublicApiBlockSource.nextDataHeight", () => {
	function sourceWith(hits: Record<string, number | null>) {
		const http = {
			firstEventHeight: async (
				type: string,
				_from: number,
				_to: number,
				contractId?: string,
			) => hits[`${type}|${contractId ?? ""}`] ?? null,
			// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any;
		return new PublicApiBlockSource(
			http,
			["ft_transfer"],
			[
				{ eventType: "ft_transfer", contractId: "SP1.token" },
				{ eventType: "ft_mint", contractId: "SP1.token" },
			],
		);
	}

	test("returns the minimum hit across targets", async () => {
		const s = sourceWith({
			"ft_transfer|SP1.token": 5000,
			"ft_mint|SP1.token": 1200,
		});
		expect(await s.nextDataHeight(100, 10000)).toBe(1200);
	});

	test("returns null when no target hits (rest of range empty)", async () => {
		const s = sourceWith({});
		expect(await s.nextDataHeight(100, 10000)).toBeNull();
	});
});

describe("scope: probe targets and event walks share one helper", () => {
	test("wildcard, trait and factory filters stay unscoped", () => {
		for (const filter of [
			{ type: "print_event", contractId: "SP1.pool-*" },
			{ type: "print_event", contractId: ["SP1.a", "SP1.*"] },
			{ type: "print_event", trait: "sip-010" },
			{
				type: "print_event",
				factory: { from: "created", field: "data.pool" },
			},
			{ type: "ft_transfer", assetIdentifier: "*::tok" },
		]) {
			expect(sparseProbeTargets(def({ a: filter }))).toEqual([
				{ eventType: filter.type === "ft_transfer" ? "ft_transfer" : "print" },
			]);
		}
	});

	test("a contract array fans out to one target per contract", () => {
		expect(
			sparseProbeTargets(
				def({ a: { type: "print_event", contractId: ["SP1.a", "SP1.b"] } }),
			),
		).toEqual([
			{ eventType: "print", contractId: "SP1.a" },
			{ eventType: "print", contractId: "SP1.b" },
		]);
	});

	test("one unscoped filter collapses its type to a single unscoped target", () => {
		expect(
			sparseProbeTargets(
				def({
					a: { type: "print_event", contractId: "SP1.a" },
					b: { type: "print_event" },
					c: { type: "print_event", contractId: "SP1.c" },
				}),
			),
		).toEqual([{ eventType: "print" }]);
	});
});

describe("PublicApiBlockSource.loadBlockRange walks", () => {
	const block = (h: number) => ({
		block_height: h,
		block_hash: `0xh${h}`,
		parent_hash: `0xh${h - 1}`,
		burn_block_height: h,
		burn_block_hash: null,
		block_time: "2026-01-01T00:00:00.000Z",
	});
	const print = (h: number, idx: number, contract: string) => ({
		event_type: "print",
		block_height: h,
		tx_id: `0xt${h}`,
		tx_index: 0,
		event_index: idx,
		contract_id: contract,
		tx_sender: "SP1.s",
		tx_type: "contract_call",
		tx_status: "success",
		tx_contract_id: contract,
		tx_function_name: "f",
		payload: { topic: "print", value: null, raw_value: "0x00" },
	});

	function recorder(rows: ReturnType<typeof print>[]) {
		const calls: { type: string; contractId?: string }[] = [];
		const http = {
			walkBlocks: async () => [block(1), block(2)],
			walkTransactions: async () => [],
			walkEvents: async (
				type: string,
				_from: number,
				_to: number,
				_withTx: boolean,
				contractId?: string,
			) => {
				calls.push({ type, contractId });
				return rows.filter((r) => !contractId || r.contract_id === contractId);
			},
			// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any;
		return { http, calls };
	}

	test("scoped filters walk per contract and never unscoped", async () => {
		const { http, calls } = recorder([
			print(1, 0, "SP1.a"),
			print(2, 0, "SP1.b"),
			print(2, 1, "SP1.other"),
		]);
		const src = new PublicApiBlockSource(
			http,
			["print"],
			[
				{ eventType: "print", contractId: "SP1.a" },
				{ eventType: "print", contractId: "SP1.b" },
			],
			false,
		);
		const map = await src.loadBlockRange(1, 2);
		expect(calls).toEqual([
			{ type: "print", contractId: "SP1.a" },
			{ type: "print", contractId: "SP1.b" },
		]);
		expect(map.get(1)?.events).toHaveLength(1);
		expect(map.get(2)?.events).toHaveLength(1);
	});

	test("mixed scoped and unscoped for one type walks unscoped once", async () => {
		const { http, calls } = recorder([print(1, 0, "SP1.a")]);
		const src = new PublicApiBlockSource(
			http,
			["print"],
			sparseProbeTargets(
				def({
					a: { type: "print_event", contractId: "SP1.a" },
					b: { type: "print_event" },
				}),
			),
			false,
		);
		await src.loadBlockRange(1, 2);
		expect(calls).toEqual([{ type: "print", contractId: undefined }]);
	});

	test("tx-level sources keep unscoped walks for complete tx event sets", async () => {
		const { http, calls } = recorder([]);
		const src = new PublicApiBlockSource(
			http,
			["print"],
			[{ eventType: "print", contractId: "SP1.a" }],
			true,
		);
		await src.loadBlockRange(1, 2);
		expect(calls).toEqual([{ type: "print", contractId: undefined }]);
	});

	test("rows returned by overlapping walks are deduped", async () => {
		const row = print(1, 0, "SP1.a");
		const http = {
			walkBlocks: async () => [block(1)],
			walkTransactions: async () => [],
			walkEvents: async () => [row],
			// biome-ignore lint/suspicious/noExplicitAny: test stub
		} as any;
		const src = new PublicApiBlockSource(
			http,
			["print"],
			[
				{ eventType: "print", contractId: "SP1.a" },
				{ eventType: "print", contractId: "SP1.b" },
			],
			false,
		);
		expect((await src.loadBlockRange(1, 1)).get(1)?.events).toHaveLength(1);
	});
});
