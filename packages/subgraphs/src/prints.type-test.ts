/**
 * Type-level tests for the widened `prints` vocabulary — nested tuples,
 * lists, and optional fields. Checked by `tsc` (src is included), never
 * bundled nor run.
 *
 * The case that matters: BNS-V2 emits `name` as a NESTED tuple. Before this
 * vocabulary the only composite was `"jsonb"` (→ `Record<string, unknown>`),
 * so a handler reading flat `data.name` type-checked, deployed, and decoded
 * to null on every event for an entire release.
 */
import { expectTypeOf } from "expect-type";
import { defineSubgraph } from "./define.ts";

export function _printsTypeChecks(): void {
	const def = defineSubgraph({
		name: "bns-names",
		sources: {
			bns: {
				type: "print_event",
				contractId: "SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2",
				prints: {
					"name-register": {
						name: { tuple: { name: "text", namespace: "text" } },
						owner: "principal",
						memo: { type: "text", optional: true },
						ids: { list: "uint" },
					},
				},
			},
		},
		schema: { names: { columns: { owner: { type: "principal" } } } },
		handlers: {
			bns: (event, ctx) => {
				// Nested tuple: typed all the way down, no cast.
				expectTypeOf(event.data.name).toEqualTypeOf<{
					name: string;
					namespace: string;
				}>();
				expectTypeOf(event.data.name.namespace).toEqualTypeOf<string>();
				expectTypeOf(event.data.owner).toEqualTypeOf<string>();
				// Optional field → optional KEY, so a reader must handle absence.
				expectTypeOf(event.data.memo).toEqualTypeOf<string | undefined>();
				// Lists carry their element type.
				expectTypeOf(event.data.ids).toEqualTypeOf<bigint[]>();
				// The topic is the discriminant.
				expectTypeOf(event.topic).toEqualTypeOf<"name-register">();

				// @ts-expect-error — the flat shape the broken handler assumed
				const _flat: string = event.data.name;
				// @ts-expect-error — undeclared field
				event.data.nope;

				ctx.insert("names", { owner: event.data.owner });
			},
		},
	});
	void def;
}
