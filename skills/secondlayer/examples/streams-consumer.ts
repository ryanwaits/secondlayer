// Build-your-own indexer on top of Streams, with transactional checkpointing
// and reorg rollback.
//
// `events.consume(...)` polls forever (mode: "tail") and calls your callbacks
// per page. Whatever you write in onBatch *is* your index. The SDK owns the
// cursor (where to poll next, reorg dedup, rewind) and hands you the checkpoint
// to persist — you persist it inside the SAME transaction as your writes, so a
// crash can only replay a batch, never half-apply one.
//
// The store here is Bun's built-in SQLite so the example runs as-is. Swap it
// for Postgres/your DB of choice — the shape is what matters:
//   * projection rows + the checkpoint cursor are written in ONE transaction
//   * rows are keyed by `event.cursor` (the stable per-event id), so replaying
//     a batch is an idempotent no-op
//   * rows carry block_height so a reorg can delete everything above the fork
//
// Run:  SL_API_KEY=sk-sl_... bun examples/streams-consumer.ts

import { Database } from "bun:sqlite";
import { createStreamsClient } from "@secondlayer/sdk/streams";
import type { StreamsEvent } from "@secondlayer/sdk/streams";

const streams = createStreamsClient({
	apiKey: process.env.SL_API_KEY!,
});

// --- Store -----------------------------------------------------------------

const db = new Database("index.sqlite");
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id           TEXT PRIMARY KEY,   -- event.cursor: stable across replays
    block_height INTEGER NOT NULL,
    event_type   TEXT NOT NULL,
    tx_id        TEXT NOT NULL,
    payload      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_block_height ON events (block_height);

  CREATE TABLE IF NOT EXISTS checkpoint (
    id     INTEGER PRIMARY KEY CHECK (id = 1),
    cursor TEXT
  );
  INSERT OR IGNORE INTO checkpoint (id, cursor) VALUES (1, NULL);
`);

const upsertEvent = db.query(
	`INSERT INTO events (id, block_height, event_type, tx_id, payload)
   VALUES ($id, $block_height, $event_type, $tx_id, $payload)
   ON CONFLICT(id) DO UPDATE SET
     block_height = excluded.block_height,
     event_type   = excluded.event_type,
     tx_id        = excluded.tx_id,
     payload      = excluded.payload`,
);
const deleteAboveHeight = db.query(
	"DELETE FROM events WHERE block_height > $fork_point",
);
const setCursor = db.query(
	"UPDATE checkpoint SET cursor = $cursor WHERE id = 1",
);

function loadCursor(): string | null {
	const row = db.query("SELECT cursor FROM checkpoint WHERE id = 1").get() as {
		cursor: string | null;
	};
	return row.cursor;
}

// Apply a page of canonical events + persist the checkpoint, atomically.
const applyBatch = db.transaction(
	(events: StreamsEvent[], cursor: string | null) => {
		for (const event of events) {
			upsertEvent.run({
				$id: event.cursor,
				$block_height: event.block_height,
				$event_type: event.event_type,
				$tx_id: event.tx_id,
				$payload: JSON.stringify(event.payload),
			});
		}
		setCursor.run({ $cursor: cursor });
	},
);

// Roll a reorg back: drop every row above the fork point and persist the rewind
// cursor in the same transaction, so the two commit together (crash-safe).
const rollbackReorg = db.transaction((forkPoint: number, cursor: string) => {
	deleteAboveHeight.run({ $fork_point: forkPoint });
	setCursor.run({ $cursor: cursor });
});

// --- Consumer --------------------------------------------------------------

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

await streams.events.consume({
	fromCursor: loadCursor(),
	mode: "tail",
	types: ["ft_transfer", "nft_transfer"], // narrow the firehose
	batchSize: 100,
	emptyBackoffMs: 2000,
	signal: controller.signal,

	// The SDK hands you the cursor to persist for this batch; write it in the
	// same transaction as your rows. No return value needed.
	onBatch(events, _envelope, { cursor }) {
		applyBatch(events, cursor);
		const tail = events.at(-1);
		if (tail)
			console.log(
				`+${events.length} events, head @ block ${tail.block_height}`,
			);
	},

	// The SDK detects + dedups the reorg and hands you the rewind cursor; your
	// only job is to roll the projection back to the fork point. The SDK then
	// rewinds and re-reads the now-canonical events.
	onReorg(reorg, { cursor }) {
		rollbackReorg(reorg.fork_point_height, cursor);
		console.warn(`reorg @ fork ${reorg.fork_point_height} — rolled back`);
	},
});

console.log("Consumer stopped.");
