import { Database } from "bun:sqlite";
import { SecondLayer } from "@secondlayer/sdk";

const db = new Database("transfers.sqlite");
db.run(`create table if not exists transfers (
  cursor text primary key,
  block_height integer not null,
  sender text not null,
  recipient text not null,
  amount text not null
)`);
db.run(
	"create table if not exists checkpoint (id integer primary key check (id = 1), cursor text)",
);

const sl = new SecondLayer();
const saved = db
	.query<{ cursor: string | null }, []>("select cursor from checkpoint")
	.get();

await sl.streams.events.consume({
	types: ["ft_transfer"],
	// !callout[/fromCursor/] Null on the first run, so the sweep starts at the beginning.
	fromCursor: saved?.cursor ?? null,
	onBatch: (events, _envelope, ctx) => {
		db.transaction(() => {
			for (const event of events) {
				// !callout[/event_type/] Each event is a union until you check its type.
				if (event.event_type !== "ft_transfer") continue;
				db.query("insert or replace into transfers values (?, ?, ?, ?, ?)").run(
					event.cursor,
					event.block_height,
					event.payload.sender,
					event.payload.recipient,
					event.payload.amount,
				);
			}
			// !callout[/ctx.cursor/] Commit the checkpoint in the same transaction as the rows.
			db.query("insert or replace into checkpoint values (1, ?)").run(
				ctx.cursor,
			);
		})();
		return ctx.cursor;
	},
	onReorg: (reorg, ctx) => {
		db.transaction(() => {
			// !callout[/>=/] The fork block itself is replaced, so delete from it upward.
			db.query("delete from transfers where block_height >= ?").run(
				reorg.fork_point_height,
			);
			db.query("insert or replace into checkpoint values (1, ?)").run(
				ctx.cursor,
			);
		})();
	},
});
