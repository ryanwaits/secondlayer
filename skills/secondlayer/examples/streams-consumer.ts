// Long-running Streams consumer with cursor checkpointing.
//
// `events.consume(...)` polls forever (mode: "tail") and calls your onBatch
// callback. Return a cursor string from onBatch to mark it "committed";
// the consumer will resume from there on restart.
//
// Run:  SL_STREAMS_API_KEY=sk-sl_... bun examples/streams-consumer.ts

import { createStreamsClient } from "@secondlayer/sdk/streams";
import { readFile, writeFile } from "node:fs/promises";

const streams = createStreamsClient({
  apiKey: process.env.SL_STREAMS_API_KEY!,
});

const CHECKPOINT_FILE = ".streams-cursor";

async function loadCursor(): Promise<string | null> {
  try {
    return (await readFile(CHECKPOINT_FILE, "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

async function saveCursor(cursor: string) {
  await writeFile(CHECKPOINT_FILE, cursor);
}

const startCursor = await loadCursor();

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

await streams.events.consume({
  fromCursor: startCursor,
  mode: "tail",
  types: ["ft_transfer", "nft_transfer"], // narrow firehose
  batchSize: 100,
  emptyBackoffMs: 2000,
  signal: controller.signal,

  async onBatch(events, envelope) {
    for (const event of events) {
      // Process event. If you write to a DB, do it transactionally
      // and only return the new cursor AFTER the commit succeeds.
      console.log(event.type, event.txId);
    }

    if (envelope.next_cursor) {
      await saveCursor(envelope.next_cursor);
      return envelope.next_cursor;
    }
    return null;
  },
});

console.log("Consumer stopped.");
