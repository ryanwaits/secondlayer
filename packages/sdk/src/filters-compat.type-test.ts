/**
 * CI gate (type level): the canonical `@secondlayer/stacks/filters`
 * projections must be assignable to THIS package's param types — the whole
 * "write the filter once" promise. Checked by `tsc` (src is included),
 * never bundled nor run. If a surface's params drift, this file breaks the
 * build instead of a user's integration.
 */
import { on } from "@secondlayer/stacks/filters";
import { expectTypeOf } from "expect-type";
import type {
	ContractCallsConsumeParams,
	ContractCallsListParams,
	EventsListParams,
} from "./index-api/client.ts";
import type {
	StreamsEventsConsumeParams,
	StreamsEventsListParams,
} from "./streams/types.ts";
import type { ChainTrigger } from "./subscriptions/client.ts";

export function _filterCompatChecks(): void {
	const ft = on.ftTransfer({
		assetIdentifier:
			"SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC",
	});

	// Index events: the projection (plus caller extras) IS an EventsListParams.
	expectTypeOf(
		ft.toIndexParams({ limit: 100 as number }),
	).toMatchTypeOf<EventsListParams>();

	// Streams: list and consume both accept the projection spread.
	expectTypeOf(ft.toStreamsParams()).toMatchTypeOf<
		Pick<StreamsEventsListParams, "types" | "assetIdentifier" | "contractId">
	>();
	const consumeParams: StreamsEventsConsumeParams = {
		...ft.toStreamsParams(),
		onBatch: () => undefined,
	};
	void consumeParams;

	// Contract calls: separate endpoint, separate projection.
	const call = on.contractCall({
		contractId: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.marketplace",
		functionName: "purchase-asset",
	});
	expectTypeOf(
		call.toContractCallsParams(),
	).toMatchTypeOf<ContractCallsListParams>();
	expectTypeOf(call.toContractCallsParams()).toMatchTypeOf<
		Pick<ContractCallsConsumeParams, "contractId" | "functionName">
	>();

	// Triggers: every member's projection is a valid ChainTrigger — including
	// the Subscriptions-only sBTC members.
	expectTypeOf(ft.toChainTrigger()).toMatchTypeOf<ChainTrigger>();
	expectTypeOf(
		on.sbtcDeposit({ minAmount: 1n }).toChainTrigger(),
	).toMatchTypeOf<ChainTrigger>();
	expectTypeOf(
		on.stxTransfer({ minAmount: 5n, maxAmount: 9n }).toChainTrigger(),
	).toMatchTypeOf<ChainTrigger>();
	expectTypeOf(
		on.print({ topic: "transfer" }).toChainTrigger(),
	).toMatchTypeOf<ChainTrigger>();
	expectTypeOf(
		on.contractDeploy({ contractName: "x" }).toChainTrigger(),
	).toMatchTypeOf<ChainTrigger>();
}
