/**
 * Type-level tests for defineSubgraph authoring gates: pinned print_event
 * requires `prints`, TypedHandlers keys are required, contract_call+functionName
 * requires `abi`. Checked by `tsc`; never bundled nor run.
 */
import { expectTypeOf } from "expect-type";
import { defineSubgraph } from "./define.ts";
import type { PrintEventPayload } from "./events.ts";
import type { PrintEventFilter } from "./types.ts";

const schema = {
	rows: { columns: { n: { type: "uint" as const } } },
};

// Pinned print_event without prints is refused at the type level.
defineSubgraph({
	name: "missing-prints",
	sources: {
		// @ts-expect-error — pinned print_event requires prints
		prints: { type: "print_event", contractId: "SP000.c" },
	},
	schema,
	handlers: {
		prints: () => {},
	},
});

// Trait / unpinned may omit prints.
defineSubgraph({
	name: "trait-print",
	sources: {
		traited: { type: "print_event", trait: "sip-xxx" },
		unpinned: { type: "print_event" },
	},
	schema,
	handlers: {
		traited: (event) => {
			expectTypeOf(event).toEqualTypeOf<PrintEventPayload>();
		},
		unpinned: (event) => {
			expectTypeOf(event).toEqualTypeOf<PrintEventPayload>();
		},
	},
});

// Every source key needs a handler (TypedHandlers `-?`).
defineSubgraph({
	name: "missing-handler",
	sources: {
		stx: { type: "stx_transfer" },
	},
	schema,
	// @ts-expect-error — source "stx" has no handler
	handlers: {},
});

// materialize sources may omit a handler entry.
defineSubgraph({
	name: "materialize-only",
	sources: {
		swap: {
			type: "print_event",
			contractId: "SP000.c",
			prints: { swap: { dx: "uint" } },
			materialize: {
				table: "rows",
				columns: { n: { from: "dx" } },
			},
		},
	},
	schema,
	handlers: {},
});

// functionName⇒abi is enforced at validate (not in the filter type — a TS
// conditional broke trigger helpers). Documented here as intentional.
const _callWithFnNoAbi: {
	type: "contract_call";
	contractId: string;
	functionName: string;
} = {
	type: "contract_call",
	contractId: "SP000.c",
	functionName: "transfer",
};
void _callWithFnNoAbi;

// Loose PrintEventFilter still covers the untyped payload path for EventForFilter
// consumers that pass the union without a concrete prints map.
type _Unpinned = Extract<PrintEventFilter, { contractId?: undefined }>;
expectTypeOf<_Unpinned>().not.toEqualTypeOf<never>();
