/**
 * Type-level tests for `fields` narrowing on Index reads. Checked by `tsc`
 * (src is included), never bundled nor run.
 *
 * The server projects the SELECT, so an unrequested column is physically
 * absent from the payload. Before this, the type still promised it — the
 * same unsoundness `findMany({ fields })` shipped with on the subgraphs
 * side. Reading one must be a compile error, not `undefined` at runtime.
 */
import { expectTypeOf } from "expect-type";
import type { Index, IndexFtTransfer } from "./index-api/client.ts";

export async function _indexFieldsChecks(index: Index): Promise<void> {
	const narrowed = await index.events.list({
		eventType: "ft_transfer",
		fields: ["recipient", "amount"],
		limit: 10,
	});
	// Assert on the ARRAY element type (indexing adds `| undefined`, which
	// expect-type compares structurally and reports confusingly).
	expectTypeOf(narrowed.events).toEqualTypeOf<
		{
			cursor: string;
			block_height: number;
			event_type: "ft_transfer";
			recipient: string;
			amount: string;
		}[]
	>();

	const row = narrowed.events[0];
	// @ts-expect-error — not requested, so not fetched and not present
	row?.asset_identifier;
	// @ts-expect-error — likewise
	row?.block_time;

	// Unknown column names are rejected at the call site.
	// @ts-expect-error — `nope` is not a column of an ft_transfer row
	await index.events.list({ eventType: "ft_transfer", fields: ["nope"] });

	// Without `fields`, the full row is unchanged.
	const full = await index.events.list({ eventType: "ft_transfer" });
	expectTypeOf(full.events).toEqualTypeOf<IndexFtTransfer[]>();
}
