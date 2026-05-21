/**
 * Type-level tests for typed handler events. Type-checked by `tsc` (src is
 * included) but never bundled (not a bunup entry) nor run (not a `*.test.ts`
 * file) — every assertion is purely at the type level.
 */
import { expectTypeOf } from "expect-type";
import { defineSubgraph } from "./define.ts";
import type {
	AnyEvent,
	ContractDeployPayload,
	EventForFilter,
	FtTransferPayload,
	PrintEventPayload,
	StxTransferPayload,
} from "./events.ts";
import type { ContractCallEvent } from "./types.ts";
import type {
	ContractCallFilter,
	ContractDeployFilter,
	FtTransferFilter,
	NftTransferFilter,
	PrintEventFilter,
	StxTransferFilter,
} from "./types.ts";

// ── EventForFilter maps each source type to its payload ──────────────────

expectTypeOf<
	EventForFilter<PrintEventFilter>
>().toEqualTypeOf<PrintEventPayload>();
expectTypeOf<
	EventForFilter<PrintEventFilter>["topic"]
>().toEqualTypeOf<string>();

expectTypeOf<
	EventForFilter<FtTransferFilter>
>().toEqualTypeOf<FtTransferPayload>();
expectTypeOf<
	EventForFilter<FtTransferFilter>["amount"]
>().toEqualTypeOf<bigint>();

expectTypeOf<
	EventForFilter<StxTransferFilter>
>().toEqualTypeOf<StxTransferPayload>();
expectTypeOf<
	EventForFilter<StxTransferFilter>["memo"]
>().toEqualTypeOf<string>();

// nft tokenId is intentionally `unknown` (asset-dependent).
expectTypeOf<
	EventForFilter<NftTransferFilter>["tokenId"]
>().toEqualTypeOf<unknown>();

expectTypeOf<
	EventForFilter<ContractCallFilter>
>().toEqualTypeOf<ContractCallEvent>();
expectTypeOf<EventForFilter<ContractCallFilter>["args"]>().toEqualTypeOf<
	unknown[]
>();

expectTypeOf<
	EventForFilter<ContractDeployFilter>
>().toEqualTypeOf<ContractDeployPayload>();

// Negative: topic is a string, not a number.
expectTypeOf<
	EventForFilter<PrintEventFilter>["topic"]
>().not.toEqualTypeOf<number>();

// ── End-to-end: inline handler `event` is inferred from its source ───────

defineSubgraph({
	name: "type-test",
	sources: {
		print: { type: "print_event", contractId: "SP000.c" },
		ftXfer: { type: "ft_transfer" },
	},
	schema: {
		rows: {
			columns: {
				topic: { type: "text" },
				amount: { type: "uint" },
				note: { type: "text", nullable: true },
			},
		},
	},
	handlers: {
		print: (event, ctx) => {
			expectTypeOf(event).toEqualTypeOf<PrintEventPayload>();
			expectTypeOf(event.topic).toEqualTypeOf<string>();
			// ctx.insert is typed against the schema: topic+amount required,
			// nullable `note` optional.
			ctx.insert("rows", { topic: event.topic, amount: 1n });
			ctx.insert("rows", { topic: "t", amount: 1n, note: null });
			// @ts-expect-error amount must be bigint, not number
			ctx.insert("rows", { topic: "t", amount: 1 });
			// @ts-expect-error unknown table
			ctx.insert("nope", { topic: "t", amount: 1n });
			// @ts-expect-error unknown column
			ctx.insert("rows", { topic: "t", amount: 1n, bogus: 1 });
			// @ts-expect-error missing required column `amount`
			ctx.insert("rows", { topic: "t" });
		},
		ftXfer: (event) => {
			expectTypeOf(event.amount).toEqualTypeOf<bigint>();
		},
		"*": (event) => {
			expectTypeOf(event).toEqualTypeOf<AnyEvent>();
		},
	},
});
