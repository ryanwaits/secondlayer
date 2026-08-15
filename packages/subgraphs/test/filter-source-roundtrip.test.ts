import { describe, expect, test } from "bun:test";
import { fromSubgraphSource } from "@secondlayer/stacks/filters";
import type { SubgraphFilter } from "../src/types.ts";

/**
 * CI gate: every subgraph filter must survive
 * `toSubgraphSource(fromSubgraphSource(f))` unchanged. This pins two things:
 * the canonical vocabulary can express every filter that can be deployed, and
 * the projection is lossless — a migration to `on.*` can never silently
 * change what a live subgraph indexes.
 *
 * The fixtures were the four `subgraphs/` templates until those were retired.
 * They covered only 3 of the 13 members of `SubgraphFilter`, so the gate now
 * enumerates the union directly: every member, with its optional fields
 * populated, since an unset field cannot prove the round trip preserves it.
 * `UNION_MEMBERS` below is asserted to cover every `type` in the union — a new
 * filter type fails this test until it is represented here.
 */

const FIXTURES: Array<{ name: string; filter: SubgraphFilter }> = [
	{
		name: "stx_transfer",
		filter: {
			type: "stx_transfer",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			recipient: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
			minAmount: 1_000_000n,
			maxAmount: 500_000_000n,
		},
	},
	{
		name: "stx_mint",
		filter: {
			type: "stx_mint",
			recipient: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			minAmount: 1n,
		},
	},
	{
		name: "stx_burn",
		filter: {
			type: "stx_burn",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			minAmount: 1n,
		},
	},
	{
		name: "stx_lock",
		filter: {
			type: "stx_lock",
			lockedAddress: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			minAmount: 1n,
		},
	},
	{
		name: "ft_transfer",
		filter: {
			type: "ft_transfer",
			assetIdentifier:
				"SP3DX3H4FEYZJZ586MFBS25ZW3HZDMEW92260R2PR.Wrapped-USD::wrapped-usd",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			recipient: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
			minAmount: 100n,
		},
	},
	{
		name: "ft_mint",
		filter: {
			type: "ft_mint",
			assetIdentifier:
				"SP3DX3H4FEYZJZ586MFBS25ZW3HZDMEW92260R2PR.Wrapped-USD::wrapped-usd",
			recipient: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			minAmount: 1n,
		},
	},
	{
		name: "ft_burn",
		filter: {
			type: "ft_burn",
			assetIdentifier:
				"SP3DX3H4FEYZJZ586MFBS25ZW3HZDMEW92260R2PR.Wrapped-USD::wrapped-usd",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			minAmount: 1n,
		},
	},
	{
		name: "nft_transfer",
		filter: {
			type: "nft_transfer",
			assetIdentifier:
				"SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bitcoin-monkeys::bitcoin-monkeys",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			recipient: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
		},
	},
	{
		name: "nft_mint",
		filter: {
			type: "nft_mint",
			assetIdentifier:
				"SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bitcoin-monkeys::bitcoin-monkeys",
			recipient: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
		},
	},
	{
		name: "nft_burn",
		filter: {
			type: "nft_burn",
			assetIdentifier:
				"SP2KAF9RF86PVX3NEE27DFV1CQX0T4WGR41X3S45C.bitcoin-monkeys::bitcoin-monkeys",
			sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
		},
	},
	// Was `pox-stacking`: a single-contract call source.
	{
		name: "contract_call (single contract)",
		filter: {
			type: "contract_call",
			contractId: "SP000000000000000000002Q6VF78.pox-4",
		},
	},
	// The contractId SET + functionName + caller shape, which no retired
	// template exercised.
	{
		name: "contract_call (contract set)",
		filter: {
			type: "contract_call",
			contractId: [
				"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.router",
				"SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.pool-*",
			],
			functionName: "swap",
			caller: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
		},
	},
	// Was `contract-deployments`.
	{
		name: "contract_deploy",
		filter: {
			type: "contract_deploy",
			deployer: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF",
			contractName: "my-contract",
		},
	},
	// Was `bns-names` / `sbtc-flows`.
	{
		name: "print_event (single contract)",
		filter: {
			type: "print_event",
			contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
		},
	},
	{
		name: "print_event (topic + set)",
		filter: {
			type: "print_event",
			contractId: [
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-*",
			],
			topic: "completed-deposit",
		},
	},
];

/** Every `type` in the SubgraphFilter union — the coverage target. */
const UNION_MEMBERS = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
] as const;

describe("subgraph sources round-trip the canonical vocabulary (CI gate)", () => {
	for (const { name, filter } of FIXTURES) {
		test(`${name}: toSubgraphSource(fromSubgraphSource(f)) deep-equals f`, () => {
			const roundTripped = fromSubgraphSource(
				// The canonical spec union is structurally a superset of
				// SubgraphFilter (same members, same fields).
				filter as Parameters<typeof fromSubgraphSource>[0],
			).toSubgraphSource();
			expect(roundTripped, name).toEqual(filter);
		});
	}

	test("every member of the SubgraphFilter union has a fixture", () => {
		const covered = new Set(FIXTURES.map((f) => f.filter.type));
		expect([...UNION_MEMBERS].filter((t) => !covered.has(t))).toEqual([]);
	});
});
