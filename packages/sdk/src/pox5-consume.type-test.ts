/**
 * Type-level test for `pox5.events.consume`. Checked by `tsc` (src is
 * included), never bundled nor run.
 *
 * `consume` owns paging internally — `cursor`/`limit` are the loop's own
 * page-fetch args, not caller-supplied filters, so accepting them here would
 * let a caller silently fight the loop's own pagination.
 */
import type { Index } from "./index.ts";

declare const sl: { index: Index };

async function consumeExists() {
	await sl.index.pox5.events.consume({
		signer: "SP1.fastpool-signer-manager",
		onBatch: () => undefined,
	});
}
void consumeExists;

async function consumeRejectsPagingParams() {
	await sl.index.pox5.events.consume({
		// @ts-expect-error — cursor is the loop's own page cursor, not a filter
		cursor: "1:0",
		onBatch: () => undefined,
	});

	await sl.index.pox5.events.consume({
		// @ts-expect-error — limit is the loop's own page size (batchSize), not a filter
		limit: 10,
		onBatch: () => undefined,
	});
}
void consumeRejectsPagingParams;
