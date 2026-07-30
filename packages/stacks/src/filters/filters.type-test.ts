/**
 * Type-level tests for the `on.*` member gating and literal preservation.
 * Checked by `tsc` (src is included; `*.test.ts` is NOT — which is why these
 * live in a `.type-test.ts`), never bundled nor run.
 */
import { expectTypeOf } from "expect-type";
import { on } from "./factories.ts";

export function _filterTypeChecks(): void {
	// Member gating: a surface a member can't reach is a MISSING METHOD.
	const sbtc = on.sbtcDeposit({ minAmount: 100_000n });
	expectTypeOf(sbtc).toHaveProperty("toChainTrigger");
	expectTypeOf(sbtc).not.toHaveProperty("toIndexParams");
	expectTypeOf(sbtc).not.toHaveProperty("toStreamsParams");
	expectTypeOf(sbtc).not.toHaveProperty("toSubgraphSource");

	const call = on.contractCall({ functionName: "purchase-asset" });
	expectTypeOf(call).toHaveProperty("toContractCallsParams");
	expectTypeOf(call).toHaveProperty("toSubgraphSource");
	expectTypeOf(call).not.toHaveProperty("toIndexParams");
	expectTypeOf(call).not.toHaveProperty("toStreamsParams");

	const deploy = on.contractDeploy({});
	expectTypeOf(deploy).toHaveProperty("toChainTrigger");
	expectTypeOf(deploy).toHaveProperty("toSubgraphSource");
	expectTypeOf(deploy).not.toHaveProperty("toIndexParams");

	const ft = on.ftTransfer({ minAmount: 1n });
	expectTypeOf(ft).toHaveProperty("toIndexParams");
	expectTypeOf(ft).toHaveProperty("toStreamsParams");
	expectTypeOf(ft).toHaveProperty("toSubgraphSource");
	expectTypeOf(ft).not.toHaveProperty("toContractCallsParams");

	// Amounts are bigint in the canonical vocabulary — a raw number is refused.
	// @ts-expect-error — minAmount must be bigint, not number
	on.ftTransfer({ minAmount: 1_000_000 });
	// Unknown fields are refused per member.
	// @ts-expect-error — stx_mint has no sender field
	on.stxMint({ sender: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF" });

	// `prints` literals survive toSubgraphSource() — this is what feeds
	// PrintEventFor narrowing inside defineSubgraph.
	const printFilter = on.print({
		prints: { transfer: { amount: "uint", sender: "principal" } },
	});
	const source = printFilter.toSubgraphSource();
	expectTypeOf(source.type).toEqualTypeOf<"print_event">();
	type Prints = NonNullable<typeof source.prints>;
	expectTypeOf<Prints["transfer"]["amount"]>().toEqualTypeOf<"uint">();
	// @ts-expect-error — undeclared topic
	type _Missing = Prints["burn"];

	// `abi` literals survive the same way for contract_call sources.
	// (`outputs` is a bare AbiType; the const literal keeps its exact shape.)
	const abi = {
		functions: [
			{
				name: "purchase-asset",
				access: "public",
				args: [{ name: "token-id", type: "uint128" }],
				outputs: "bool",
			},
		],
	} as const;
	const callWithAbi = on.contractCall({ abi, functionName: "purchase-asset" });
	const callSource = callWithAbi.toSubgraphSource();
	expectTypeOf<NonNullable<typeof callSource.abi>>().toEqualTypeOf<
		typeof abi
	>();
}
