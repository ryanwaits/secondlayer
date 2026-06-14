import { Index } from "@secondlayer/sdk";
import { db, loadCheckpoint, migrate } from "./schema.ts";

// Every sale on Gamma's marketplace, swept into your own Postgres.
// First run backfills from genesis; restarts resume from the committed
// checkpoint; reorgs roll back automatically. Kill it anywhere — it's safe.
//
// Hosted note: genesis backfill (`fromHeight: 0`) reaches full history on a
// paid plan or with pay-as-you-go credits. Free/keyless reads cover the last
// 24h, so an uncredited free run gets `402 UPGRADE_REQUIRED` below that window.
// Self-hosted instances are unbounded.
const MARKETPLACE = "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4";

await migrate();
const index = new Index();

await index.contractCalls.consume({
	contractId: MARKETPLACE,
	functionName: "purchase-asset",
	fromCursor: await loadCheckpoint(),
	fromHeight: 0, // first run only: backfill from genesis

	onBatch: async (calls, envelope, ctx) => {
		if (!ctx.cursor) return;
		// Rows and checkpoint commit in one transaction — crash anywhere and
		// the next run resumes exactly here, no gaps, no double-counts.
		await db.transaction().execute(async (tx) => {
			for (const call of calls) {
				if (call.status !== "success") continue;
				const [collection, tokenId] = call.args;
				await tx
					.insertInto("sales")
					.values({
						tx_id: call.tx_id,
						cursor: call.cursor,
						block_height: call.block_height,
						buyer: call.sender,
						collection: String(collection),
						token_id: String(tokenId),
					})
					.onConflict((oc) => oc.column("tx_id").doNothing())
					.execute();
			}
			await tx
				.insertInto("checkpoints")
				.values({ id: "sales", cursor: ctx.cursor as string })
				.onConflict((oc) =>
					oc.column("id").doUpdateSet({ cursor: ctx.cursor as string }),
				)
				.execute();
		});
		console.log(
			`+${calls.length} sales @ ${ctx.cursor} (tip ${envelope.tip.block_height})`,
		);
		return ctx.cursor;
	},

	onReorg: async (reorg) => {
		// The fork block and everything above it is no longer canonical, so the
		// delete is INCLUSIVE of `fork_point_height` (`>=`) — the new chain
		// re-supplies that block too. The consumer then rewinds and re-reads the
		// canonical run for us, starting at the fork block's first event.
		await db
			.deleteFrom("sales")
			.where("block_height", ">=", reorg.fork_point_height)
			.execute();
	},
});
