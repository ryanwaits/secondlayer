/**
 * Type-level tests for hoisting a schema out of `defineSubgraph()`.
 *
 * Before `defineSchema` + the readonly widening, neither `as const` (mutable
 * `uniqueKeys` rejected `readonly [readonly ["holder"]]`) nor a bare literal
 * (`type` widened to `string`) worked — so extracting a helper that takes
 * `ctx` meant losing the typed surface entirely. That is why the shipped
 * starter typed its helper `ctx: any`, and in doing so modelled the
 * non-commutative read-modify-write that produced a real stored balance of
 * -1489763 (see runtime/accumulator-correctness.test.ts).
 */
import { expectTypeOf } from "expect-type";
import { defineSchema, defineSubgraph } from "./define.ts";
import type { InferContext } from "./define.ts";
import type { TypedSubgraphContext } from "./infer.ts";

export const schema = defineSchema({
	balances: {
		columns: {
			asset_identifier: { type: "text" },
			holder: { type: "principal" },
			amount: { type: "uint" },
		},
		uniqueKeys: [["asset_identifier", "holder"]],
	},
});

/** The extracted helper the starter could not write before. */
function adjust(
	ctx: TypedSubgraphContext<typeof schema>,
	assetIdentifier: string,
	holder: string,
	delta: bigint,
): void {
	// Atomic, commutes under `backfillMode: "concurrent"`, reorg-safe via the
	// journal — and fully typed, no `any`.
	ctx.increment(
		"balances",
		{ asset_identifier: assetIdentifier, holder },
		{
			amount: delta,
		},
	);

	// @ts-expect-error — unknown table
	ctx.increment("nope", { holder }, { amount: delta });
	// @ts-expect-error — unknown column
	ctx.increment("balances", { holder }, { nope: delta });
}

export function _hoistedSchemaChecks(): void {
	const def = defineSubgraph({
		name: "balances",
		schema,
		sources: { xfer: { type: "ft_transfer" } },
		handlers: {
			xfer: (event, ctx) => {
				// The hoisted schema still drives ctx typing inside the definition.
				adjust(ctx, event.assetIdentifier, event.recipient, event.amount);
			},
		},
	});

	// InferContext reaches the same context type from the definition alone.
	expectTypeOf<InferContext<typeof def>>().toEqualTypeOf<
		TypedSubgraphContext<typeof schema>
	>();
	void def;
}
