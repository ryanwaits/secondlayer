/**
 * Type-level tests for `client.findMany({ fields })` projection narrowing,
 * plus the `/v1`-only option surface (no `offset`, single-column `orderBy`).
 * Checked by `tsc` (src is included) but never bundled nor run.
 *
 * The server projects the SELECT to exactly the requested columns, so an
 * unrequested field is physically absent from the payload — these assertions
 * pin that the TYPE agrees (previously `findMany({ fields: ["id"] })` still
 * promised the full row: an unsound cast in shipped code).
 */
import { expectTypeOf } from "expect-type";
import type { FindManyPage, SubgraphTableClient } from "./infer.ts";

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
	expectTypeOf(narrow).toEqualTypeOf<
		FindManyPage<{ seller: string; price: bigint }>
	>();
	// @ts-expect-error — `fee` was not requested, so it does not exist.
	narrow.rows[0]?.fee;

	// No `fields` → the full row, unchanged behavior.
	const full = await client.findMany({ where: { seller: "SP1" } });
	expectTypeOf(full).toEqualTypeOf<FindManyPage<Row>>();

	// Unknown column names are rejected at the option site.
	// @ts-expect-error — `nope` is not a column of Row.
	await client.findMany({ fields: ["nope"] });

	// `/v1` has no OFFSET pagination — only `cursor`.
	// @ts-expect-error — `offset` is not a FindManyOptions key.
	await client.findMany({ offset: 10 });

	// `orderBy` sorts one column — the keyset cursor pairs it with `_id` as
	// the tiebreaker, which only works for a single column. A second key
	// can't be rejected at the type level (plain object types don't carry a
	// key count), so this is a runtime `Error` in the SDK's `findMany`
	// instead — see `packages/sdk/src/__tests__/subgraphs.test.ts`.
	await client.findMany({ orderBy: { seller: "asc", price: "desc" } });
}
