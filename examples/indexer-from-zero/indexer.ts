import { createStreamsClient } from "@secondlayer/sdk";

// An indexer from the raw inputs: cold history from signed parquet dumps,
// then a checkpointed live tail with automatic reorg rewind. This is the
// same firehose Secondlayer's own decoder runs on.
//
//   SL_API_KEY            sk-sl_… (free ghost key: POST /v1/keys, no signup)
//   SL_STREAMS_DUMPS_URL  public dumps base URL (manifest is ed25519-signed)

const streams = createStreamsClient({
	apiKey: process.env.SL_API_KEY as string,
	dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL,
	// verify: true,  // also verify the ed25519 X-Signature on live reads
});

// Phase 1+2 in one call: hydrate finalized history from the dumps manifest
// (sha256 of every file checked against the signed manifest), then seam to
// the live firehose strictly after the dumped coverage — no gap, no dupe.
await streams.events.replay({
	from: "genesis", // every window the dumps cover (see manifest.coverage),
	// or a committed cursor to resume. Dumps start where the program began,
	// not necessarily chain block 1 — for full decoded history, use Index.

	async onDumpFile(file) {
		const bytes = await streams.dumps.download(file); // sha256-verified
		console.log(
			`dump ${file.from_block}-${file.to_block}: ${file.row_count} rows, ${bytes.byteLength} bytes`,
		);
		// Your tooling here — write to disk for DuckDB, or parse and ingest.
	},

	async onBatch(events, envelope) {
		for (const event of events) {
			// Raw normalized events: event.event_type, event.payload (undecoded).
			// Decoding raw Clarity is your job at this level — or use Index,
			// where we've already done it.
			void event;
		}
		console.log(
			`live +${events.length} @ ${envelope.next_cursor} (tip ${envelope.tip.block_height})`,
		);
		return envelope.next_cursor; // the checkpoint you committed
	},
});

// For long-lived tails with explicit reorg handling, use the consumer
// directly — onReorg fires with the fork point and the consumer rewinds:
//
// await streams.events.consume({
//   fromCursor: await loadCheckpoint(),
//   batchSize: 100,
//   onBatch: async (events, envelope) => {
//     await ingest(events);
//     return envelope.next_cursor;
//   },
//   onReorg: async (reorg) => {
//     await rollbackAbove(reorg.fork_point_height);
//   },
// });
