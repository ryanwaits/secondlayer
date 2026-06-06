/**
 * Type-level tests for `client.aggregate()` spec → result inference. Checked by
 * `tsc` (src is included) but never bundled nor run — every assertion is purely
 * at the type level. Verifies the `const` type parameter narrows the result
 * from the spec without callers writing `as const`, and that SUM/MIN/MAX reject
 * non-numeric columns.
 */
import { expectTypeOf } from "expect-type";
import type { SubgraphTableClient } from "./infer.ts";

type Row = {
	_id: string;
	_blockHeight: bigint;
	_txId: string;
	_createdAt: string;
	seller: string;
	price: bigint;
	fee: bigint | null;
};

// `async` only to allow `await`; never invoked.
export async function _aggregateTypeChecks(
	client: SubgraphTableClient<Row>,
): Promise<void> {
	// count + sum + nullable-min narrow from the literal spec (no `as const`).
	const r = await client.aggregate({
		count: true,
		sum: ["price"],
		min: ["fee"],
	});
	expectTypeOf(r.count).toEqualTypeOf<number>();
	expectTypeOf(r.sum).toEqualTypeOf<Record<"price", string>>();
	expectTypeOf(r.min).toEqualTypeOf<Record<"fee", string | null>>();

	// countDistinct accepts any column (numeric not required).
	const r2 = await client.aggregate({ countDistinct: ["seller"] });
	expectTypeOf(r2.countDistinct).toEqualTypeOf<Record<"seller", number>>();

	// System _blockHeight is numeric → valid SUM/MIN/MAX target.
	const r3 = await client.aggregate({ max: ["_blockHeight"] });
	expectTypeOf(r3.max).toEqualTypeOf<Record<"_blockHeight", string | null>>();

	// @ts-expect-error — SUM on a non-numeric (string) column is rejected.
	await client.aggregate({ sum: ["seller"] });

	// When count is not requested, the `count` key is absent from the result.
	const r4 = await client.aggregate({ sum: ["price"] });
	// @ts-expect-error — `count` is not present on this result.
	r4.count;
}
