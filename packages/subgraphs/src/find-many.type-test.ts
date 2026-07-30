/**
 * Type-level tests for `client.findMany({ fields })` projection narrowing.
 * Checked by `tsc` (src is included) but never bundled nor run.
 *
 * The server projects the SELECT to exactly the requested columns, so an
 * unrequested field is physically absent from the payload — these assertions
 * pin that the TYPE agrees (previously `findMany({ fields: ["id"] })` still
 * promised the full row: an unsound cast in shipped code).
 */
import { expectTypeOf } from "expect-type";
import type { SubgraphTableClient } from "./infer.ts";

type Row = {
	_id: string;
	_blockHeight: bigint;
	seller: string;
	price: bigint;
	fee: bigint | null;
};

// `async` only to allow `await`; never invoked.
export async function _findManyTypeChecks(
	client: SubgraphTableClient<Row>,
): Promise<void> {
	// Narrowed: only the requested fields exist on the row type.
	const narrow = await client.findMany({ fields: ["seller", "price"] });
	expectTypeOf(narrow).toEqualTypeOf<{ seller: string; price: bigint }[]>();
	// @ts-expect-error — `fee` was not requested, so it does not exist.
	narrow[0]?.fee;

	// No `fields` → the full row, unchanged behavior.
	const full = await client.findMany({ where: { seller: "SP1" } });
	expectTypeOf(full).toEqualTypeOf<Row[]>();

	// Unknown column names are rejected at the option site.
	// @ts-expect-error — `nope` is not a column of Row.
	await client.findMany({ fields: ["nope"] });
}
