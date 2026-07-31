import { describe, expect, test } from "bun:test";
import { fromSubgraphSource, on } from "../factories.ts";

const USDC =
	"SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC" as const;
const TOKEN_CONTRACT = "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc";
const ALICE = "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF";

describe("on.* factories", () => {
	test("one filter projects to all four surfaces", () => {
		const usdc = on.ftTransfer({
			assetIdentifier: USDC,
			minAmount: 1_000_000n,
		});

		// Trigger: bigint stringified at the one sanctioned boundary.
		expect(usdc.toChainTrigger()).toEqual({
			type: "ft_transfer",
			assetIdentifier: USDC,
			minAmount: "1000000",
		});

		// Subgraph source: bigint preserved.
		expect(usdc.toSubgraphSource()).toEqual({
			type: "ft_transfer",
			assetIdentifier: USDC,
			minAmount: 1_000_000n,
		});

		// Index/Streams can't express minAmount — loud, never a silent widen.
		expect(() => usdc.toIndexParams()).toThrow(/minAmount/);
		expect(() => usdc.toStreamsParams()).toThrow(/minAmount/);

		// Without the amount, both project cleanly.
		const plain = on.ftTransfer({ assetIdentifier: USDC });
		expect(plain.toIndexParams({ limit: 100 })).toEqual({
			eventType: "ft_transfer",
			assetIdentifier: USDC,
			limit: 100,
		});
		expect(plain.toStreamsParams()).toEqual({
			types: ["ft_transfer"],
			assetIdentifier: USDC,
		});
	});

	test("canonical print_event projects to Index/Streams as print", () => {
		const f = on.print({ contractId: TOKEN_CONTRACT });
		expect(f.type).toBe("print_event");
		expect(f.toIndexParams().eventType).toBe("print");
		expect(f.toStreamsParams().types).toEqual(["print"]);
		expect(f.toChainTrigger().type).toBe("print_event");
		// topic is expressible on subgraphs/triggers, not on Index/Streams reads.
		const topical = on.print({ contractId: TOKEN_CONTRACT, topic: "transfer" });
		expect(() => topical.toIndexParams()).toThrow(/topic/);
		expect(topical.toChainTrigger()).toEqual({
			type: "print_event",
			contractId: TOKEN_CONTRACT,
			topic: "transfer",
		});
	});

	test("member gating: surfaces a member can't reach are missing methods", () => {
		const sbtc = on.sbtcDeposit({ minAmount: 100_000n });
		expect(sbtc.toChainTrigger()).toEqual({
			type: "sbtc_deposit",
			minAmount: "100000",
		});
		// Runtime agrees with the type-level gating (see filters.type-test.ts).
		expect("toIndexParams" in sbtc).toBe(false);
		expect("toSubgraphSource" in sbtc).toBe(false);

		const call = on.contractCall({ contractId: TOKEN_CONTRACT });
		expect("toIndexParams" in call).toBe(false);
		expect(call.toContractCallsParams()).toEqual({
			contractId: TOKEN_CONTRACT,
		});

		const deploy = on.contractDeploy({ deployer: ALICE });
		expect("toStreamsParams" in deploy).toBe(false);
		expect(deploy.toSubgraphSource()).toEqual({
			type: "contract_deploy",
			deployer: ALICE,
		});
	});

	test("wildcards are Subscriptions/Subgraphs-only", () => {
		const wild = on.stxTransfer({ sender: "SP2QEZ*" });
		expect(wild.toChainTrigger()).toEqual({
			type: "stx_transfer",
			sender: "SP2QEZ*",
		});
		expect(() => wild.toIndexParams()).toThrow(/wildcard/);
		expect(() => wild.toStreamsParams()).toThrow(/wildcard/);
	});

	test("lockedAddress projects to Index's sender column, not a throw", () => {
		// Index normalizes stx_lock's locked_address INTO `sender` — the rename
		// was previously refused as if it were a capability gap.
		const lock = on.stxLock({ lockedAddress: ALICE });
		expect(lock.toIndexParams()).toEqual({
			eventType: "stx_lock",
			sender: ALICE,
		});
		// Streams filters probe the RAW payload, whose key is locked_address —
		// the throw there is genuine, keep it.
		expect(() => lock.toStreamsParams()).toThrow(/lockedAddress/);
	});

	test("caller projects to contract-calls' sender (the tx sender IS the caller)", () => {
		const call = on.contractCall({
			contractId: TOKEN_CONTRACT,
			caller: ALICE,
		});
		expect(call.toContractCallsParams()).toEqual({
			contractId: TOKEN_CONTRACT,
			sender: ALICE,
		});
	});

	test("trait with contractId throws at projection, pointing at subgraphs", () => {
		// The Index treats the pair as mutually exclusive; previously this
		// reached the server as a runtime 400 instead of throwing locally.
		const both = on.print({ trait: "sip-010", contractId: TOKEN_CONTRACT });
		expect(() => both.toIndexParams()).toThrow(/trait with contractId/);
		const call = on.contractCall({
			trait: "sip-010",
			contractId: TOKEN_CONTRACT,
		});
		expect(() => call.toContractCallsParams()).toThrow(/trait with contractId/);
		// Subgraph sources AND the pair — must not throw.
		expect(both.toSubgraphSource().trait).toBe("sip-010");
	});

	test("a wildcard inside a contractId array is refused, not passed to the wire", () => {
		// Regression: the guard only checked scalar values, so an array smuggled
		// the pattern through as a literal IN ('SP….pool-*') — silent zero rows.
		const wild = on.print({ contractId: [TOKEN_CONTRACT, "SP2*.pool-*"] });
		expect(() => wild.toIndexParams()).toThrow(/wildcard "SP2\*\.pool-\*"/);
		expect(() => wild.toStreamsParams()).toThrow(/wildcard/);
		// Subgraph sources keep wildcard support — must NOT throw.
		expect(wild.toSubgraphSource().contractId).toEqual([
			TOKEN_CONTRACT,
			"SP2*.pool-*",
		]);
	});

	test("trait projects to Index and triggers, never Streams", () => {
		const sip10 = on.ftTransfer({ trait: "sip-010" });
		expect(sip10.toIndexParams().trait).toBe("sip-010");
		expect(sip10.toChainTrigger().trait).toBe("sip-010");
		expect(() => sip10.toStreamsParams()).toThrow(/trait/);
	});

	test("swapped identifier kinds fail at construction, not as zero-row queries", () => {
		// A contract id where an asset identifier belongs. The compile-time
		// check is the first line of defence now (`assetIdentifier` is
		// `${string}::${string}`), so this has to be cast past to reach the
		// runtime backstop — which still matters for JS callers and for values
		// that only exist at runtime.
		expect(() =>
			on.ftTransfer({
				assetIdentifier: TOKEN_CONTRACT as `${string}::${string}`,
			}),
		).toThrow(/asset identifier/);
		// An asset identifier where a contract id belongs:
		expect(() => on.print({ contractId: USDC })).toThrow(/contract id/);
		// A garbage principal:
		expect(() => on.stxTransfer({ sender: "not-an-address" })).toThrow(
			/principal/,
		);
	});

	test("abi and prints are preserved on the subgraph source, stripped from wire shapes", () => {
		const withPrints = on.print({
			contractId: TOKEN_CONTRACT,
			prints: { transfer: { amount: "uint", sender: "principal" } },
		});
		const source = withPrints.toSubgraphSource();
		expect(source.prints).toEqual({
			transfer: { amount: "uint", sender: "principal" },
		});
		// Literal preservation is asserted in filters.type-test.ts (tsc-checked).
		// The strict trigger schema would reject unknown keys — never sent.
		expect(withPrints.toChainTrigger()).not.toHaveProperty("prints");
	});

	test("fromSubgraphSource round-trips a source object", () => {
		const source = {
			type: "ft_transfer" as const,
			assetIdentifier: USDC,
			minAmount: 5n,
		};
		expect(fromSubgraphSource(source).toSubgraphSource()).toEqual(source);
	});
});
