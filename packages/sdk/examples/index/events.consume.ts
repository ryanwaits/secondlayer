import { Database } from "bun:sqlite";
import { SecondLayer } from "@secondlayer/sdk";
import { bunSqliteSink } from "@secondlayer/sdk/sinks/bun-sqlite";

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

const db = new Database("transfers.db");
db.exec(`create table if not exists transfers (
  cursor text primary key,
  block_height integer not null,
  sender text not null,
  recipient text not null,
  amount text not null
)`);

const sl = new SecondLayer();

await sl.index.events.consume({
	eventType: "ft_transfer",
	contractId: SBTC,
	// !callout[/fromHeight/] First run only: backfill from genesis. Ignored once the sink holds a cursor.
	fromHeight: 0,
	// !callout[/sink/] Rows and the checkpoint commit together, and a reorg rolls back rows above the fork.
	sink: bunSqliteSink(db, {
		id: "sbtc-transfers",
		tables: ["transfers"],
		height: "block_height",
	}),
	onBatch: (events, _envelope, ctx) => {
		for (const event of events) {
			// !callout[/ctx.tx/] Write only through ctx.tx so the rows join the sink's transaction.
			ctx.tx.run("insert or ignore into transfers values (?, ?, ?, ?, ?)", [
				event.cursor,
				event.block_height,
				event.sender,
				event.recipient,
				event.amount,
			]);
		}
	},
});
