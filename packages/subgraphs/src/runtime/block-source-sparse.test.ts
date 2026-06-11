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
