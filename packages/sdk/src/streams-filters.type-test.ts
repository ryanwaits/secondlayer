import { expectTypeOf } from "expect-type";
import type { IndexEvent } from "./index-api/client.ts";
import type { StreamsEvent, StreamsEventForFilter } from "./streams/types.ts";

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
