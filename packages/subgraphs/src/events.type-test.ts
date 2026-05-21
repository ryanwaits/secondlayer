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
	PrintEventFor,
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

// ── Declared `prints` → typed, discriminated `event.data` per topic ──────

defineSubgraph({
	name: "prints-type-test",
	sources: {
		registry: {
			type: "print_event",
			contractId: "SP000.sbtc-registry",
			prints: {
				"completed-deposit": { amount: "uint", sender: "principal" },
				"key-rotation": { newKey: "text" },
			},
		},
	},
	schema: { flows: { columns: { topic: { type: "text" } } } },
	handlers: {
		registry: (event, ctx) => {
			expectTypeOf(event.topic).toEqualTypeOf<
				"completed-deposit" | "key-rotation"
			>();
			if (event.topic === "completed-deposit") {
				expectTypeOf(event.data.amount).toEqualTypeOf<bigint>();
				expectTypeOf(event.data.sender).toEqualTypeOf<string>();
				// @ts-expect-error newKey belongs to a different topic
				void event.data.newKey;
			}
			if (event.topic === "key-rotation") {
				expectTypeOf(event.data.newKey).toEqualTypeOf<string>();
			}
			ctx.insert("flows", { topic: event.topic });
		},
	},
});

// Undeclared `prints` falls back to the untyped payload (back-compat).
expectTypeOf<
	PrintEventFor<{ type: "print_event"; contractId: string }>
>().toEqualTypeOf<PrintEventPayload>();

// ── Declared `abi` → typed, named `event.input` for contract_call ────────

const poxAbi = {
	functions: [
		{
			name: "stack-stx",
			access: "public",
			args: [
				{ name: "amount-ustx", type: "uint128" },
				{ name: "lock-period", type: "uint128" },
			],
			outputs: "uint128",
		},
	],
} as const;

defineSubgraph({
	name: "args-type-test",
	sources: {
		stackStx: {
			type: "contract_call",
			contractId: "SP000.pox-4",
			functionName: "stack-stx",
			abi: poxAbi,
		},
		plainCall: { type: "contract_call", contractId: "SP000.c" },
	},
	schema: { rows: { columns: { n: { type: "uint" } } } },
	handlers: {
		stackStx: (event) => {
			// Named, typed args decoded via the ABI.
			expectTypeOf(event.input.amountUstx).toEqualTypeOf<bigint>();
			expectTypeOf(event.input.lockPeriod).toEqualTypeOf<bigint>();
			// Positional `args` stays for back-compat.
			expectTypeOf(event.args).toEqualTypeOf<unknown[]>();
		},
		plainCall: (event) => {
			// No abi → ContractCallEvent, positional args only.
			expectTypeOf(event.args).toEqualTypeOf<unknown[]>();
			// @ts-expect-error no typed `input` without a declared abi
			void event.input;
		},
	},
});
