import { Index, consumerHealth, shutdownSignal } from "@secondlayer/sdk";
import { kyselySink } from "@secondlayer/sdk/sinks/kysely";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

// Every sale on Gamma's marketplace, swept into your own Postgres.
// First run backfills from genesis; restarts resume from the sink's committed
// checkpoint; reorgs roll back automatically. Kill it anywhere — rows and
// cursor commit in ONE transaction, so nothing is ever half-written.
//
// Default API is http://127.0.0.1:3800 (or SL_API_URL). History is whatever
// this instance has bootstrapped.
const MARKETPLACE = "SPNWZ5V2TPWGQGVDR6T7B6RQ4XMGZ4PXTEE0VQ0S.marketplace-v4";

interface Database {
	sales: {
		tx_id: string;
		block_height: number;
		buyer: string;
		collection: string;
		token_id: string;
	};
}

const db = new Kysely<Database>({
	dialect: new PostgresDialect({
		pool: new pg.Pool({ connectionString: process.env.DATABASE_URL }),
	}),
});
await sql`CREATE TABLE IF NOT EXISTS sales (
	tx_id text PRIMARY KEY, block_height integer NOT NULL,
	buyer text NOT NULL, collection text NOT NULL, token_id text NOT NULL
)`.execute(db);

// The sink owns the checkpoint table, rows+cursor atomicity, and reorg
// rollback (delete >= fork, rewind — in one transaction). Not your problem.
const sink = kyselySink(db, {
	id: "sales",
	tables: ["sales"],
	height: "block_height",
});

// GET /health answers the platform's liveness probe: 200 while pages land,
// 503 when the loop wedges. Lag is reported, never the gate — a genesis
// backfill is millions behind and perfectly healthy.
const health = consumerHealth({ staleAfterMs: 120_000 });
const server = Bun.serve({
	port: Number(process.env.PORT ?? 8080),
	fetch: health.handler,
});

await new Index().contractCalls.consume({
	contractId: MARKETPLACE,
	functionName: "purchase-asset",
	fromHeight: 0, // first run only: the sink's cursor wins afterwards
	sink,
	signal: shutdownSignal(), // SIGTERM finishes the in-flight batch, then stops
	onProgress: health.record,
	onBatch: async (calls, _envelope, ctx) => {
		const sales = calls.filter((call) => call.status === "success");
		if (sales.length === 0) return;
		await ctx.tx
			.insertInto("sales")
			.values(
				sales.map((call) => ({
					tx_id: call.tx_id,
					block_height: call.block_height,
					buyer: call.sender,
					collection: String(call.args[0]),
					token_id: String(call.args[1]),
				})),
			)
			.onConflict((oc) => oc.column("tx_id").doNothing())
			.execute();
	},
});

// Reached on SIGTERM — never mid-batch.
await server.stop();
await db.destroy();
console.log("stopped cleanly");
