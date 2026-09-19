import { on } from "@secondlayer/stacks/filters";
import { expectTypeOf } from "expect-type";
import type { IndexEvent } from "./index-api/client.ts";
import type {
	StreamsClient,
	StreamsEvent,
	StreamsEventForFilter,
	StreamsEventOfTypes,
	StreamsEventsConsumeParams,
	StreamsEventsListParams,
	StreamsWireEvent,
	VmStreamsEvent,
} from "./streams/types.ts";

type FtTransfer = Extract<StreamsEvent, { event_type: "ft_transfer" }>;
type StxTransfer = Extract<StreamsEvent, { event_type: "stx_transfer" }>;

// A label that declares `types` narrows to exactly those variants — a per-label
// handler reads `event.payload` with no `event_type` guard.
expectTypeOf<
	StreamsEventForFilter<{ types: readonly ["ft_transfer"] }>
>().toEqualTypeOf<FtTransfer>();

expectTypeOf<
	StreamsEventForFilter<{ types: readonly ["ft_transfer", "stx_transfer"] }>
>().toEqualTypeOf<FtTransfer | StxTransfer>();

// A label without `types` keeps the full union.
expectTypeOf<
	StreamsEventForFilter<{ sender: "SP1" }>
>().toEqualTypeOf<StreamsEvent>();

// `decoded: true` narrows the Index-shaped rows the same way.
expectTypeOf<
	StreamsEventForFilter<{ types: readonly ["ft_transfer"] }, true>
>().toEqualTypeOf<Extract<IndexEvent, { event_type: "ft_transfer" }>>();

expectTypeOf<
	StreamsEventForFilter<{ sender: "SP1" }, true>
>().toEqualTypeOf<IndexEvent>();

// The narrowed payload is reachable without a guard.
declare const ftEvent: StreamsEventForFilter<{
	types: readonly ["ft_transfer"];
}>;
expectTypeOf(ftEvent.payload.asset_identifier).toEqualTypeOf<string>();

declare const stxEvent: StreamsEventForFilter<{
	types: readonly ["stx_transfer"];
}>;
// @ts-expect-error — stx_transfer payload has no asset_identifier
expectTypeOf(stxEvent.payload.asset_identifier).toBeString();

// Top-level `types` narrows too (const-generic overloads on list/stream/consume)
// — previously only labels narrowed while the flat array kept the full union.
expectTypeOf<
	StreamsEventOfTypes<["ft_transfer"]>
>().toEqualTypeOf<FtTransfer>();

declare const client: StreamsClient;
declare const unresolved: StreamsEventsListParams;
{
	const page = await client.events.list({ types: ["ft_transfer"] });
	expectTypeOf(page.events).toEqualTypeOf<FtTransfer[]>();
	const wide = await client.events.list({});
	expectTypeOf(wide.events).toEqualTypeOf<StreamsEvent[]>();
	const vmPage = await client.events.list(
		on.mapSet({ contractId: "SP.store" }).toStreamsParams(),
	);
	expectTypeOf(vmPage.events).toEqualTypeOf<VmStreamsEvent[]>();
	const unresolvedPage = await client.events.list(unresolved);
	expectTypeOf(unresolvedPage.events).toEqualTypeOf<StreamsWireEvent[]>();
	const unresolvedRow = unresolvedPage.events[0];
	if (unresolvedRow?.event_type === "map_set") {
		expectTypeOf(unresolvedRow.payload.map_name).toEqualTypeOf<string>();
	}
	const consumeParams: StreamsEventsConsumeParams = {
		...on
			.ftTransfer({
				assetIdentifier:
					"SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC",
			})
			.toStreamsParams(),
		onBatch: () => undefined,
	};
	void consumeParams;
	for await (const batch of client.consume({ types: ["stx_transfer"] })) {
		expectTypeOf(batch.events).toEqualTypeOf<StxTransfer[]>();
	}
	for await (const ev of client.events.stream({ types: ["ft_transfer"] })) {
		expectTypeOf(ev.payload.amount).toEqualTypeOf<string>();
	}
}
