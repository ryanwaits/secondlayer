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

const num = (n: number) => n.toLocaleString("en-US");

/** The date the sweep has reached. Some historical rows carry no usable
 *  `block_time`, so fall back to a placeholder rather than printing 1970. */
function reached(time: string | null | undefined): string {
	const date = time ? new Date(time) : null;
	const ok =
		date && !Number.isNaN(date.valueOf()) && date.getUTCFullYear() > 2000;
	return ok ? date.toISOString().slice(0, 10) : "──────────";
}

await migrate();
const index = new Index();

const resumeFrom = await loadCheckpoint();
// Say which run this is before the first network round trip, so a restart is
// visibly a restart and the wait for batch one isn't silence.
console.log(
	resumeFrom
		? `resuming from ${resumeFrom}`
		: "cold start — backfilling from genesis",
);
let indexed = 0;

await index.contractCalls.consume({
	contractId: MARKETPLACE,
	functionName: "purchase-asset",
	fromCursor: resumeFrom,
	fromHeight: 0, // first run only: backfill from genesis

	onBatch: async (calls, envelope, ctx) => {
		if (!ctx.cursor) return;
		// Rows and checkpoint commit in one transaction — crash anywhere and
		// the next run resumes exactly here, no gaps, no double-counts.
		const sales = calls.filter((call) => call.status === "success");
		await db.transaction().execute(async (tx) => {
			for (const call of sales) {
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
		indexed += sales.length;
		// Lead with the date the sweep has reached: it moves every line and says
		// "history, in order" at a glance. The cursor is the resumable fact, so
		// it stays — but at the end of the line, not the front.
		const last = calls.at(-1);
		console.log(
			`  ${reached(last?.block_time)}  block ${num(last?.block_height ?? 0).padStart(9)}` +
				`  ${num(indexed).padStart(8)} sales` +
				`   ${((100 * (last?.block_height ?? 0)) / envelope.tip.block_height).toFixed(1).padStart(5)}%` +
				`   ${ctx.cursor}`,
		);
		return ctx.cursor;
	},

	onReorg: async (reorg, ctx) => {
		// The fork block and everything above it is no longer canonical, so the
		// delete is INCLUSIVE of `fork_point_height` (`>=`) — the new chain
		// re-supplies that block too. The consumer then rewinds and re-reads the
		// canonical run for us, starting at the fork block's first event.
		//
		// The rollback and the rewound checkpoint commit together, for the same
		// reason `onBatch` commits rows and cursor together. Deleting alone would
		// leave the old, higher cursor on disk: a crash between the two writes
		// resumes ABOVE the fork, so the deleted range is never re-read and the
		// gap is permanent and silent. `ctx.cursor` is that rewind cursor.
		await db.transaction().execute(async (tx) => {
			await tx
				.deleteFrom("sales")
				.where("block_height", ">=", reorg.fork_point_height)
				.execute();
			await tx
				.insertInto("checkpoints")
				.values({ id: "sales", cursor: ctx.cursor })
				.onConflict((oc) => oc.column("id").doUpdateSet({ cursor: ctx.cursor }))
				.execute();
		});
	},
});
