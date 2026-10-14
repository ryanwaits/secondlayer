import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
	apiKey: process.env.SECONDLAYER_API_KEY,
	dumpsBaseUrl: process.env.STREAMS_DUMPS_BASE_URL,
});

const result = await sl.streams.events.replay({
	from: "genesis",
	// !callout[/bounded/] Return at the first empty page instead of tailing forever.
	mode: "bounded",
	onDumpFile: async (file, { from }) => {
		// !callout[/download/] Checks the file's sha256 against the signed manifest.
		const bytes = await sl.streams.dumps.download(file);
		await Bun.write(`dumps/${file.from_block}-${file.to_block}.parquet`, bytes);
		// !callout[/from/] Set on a resume. A file that straddles it arrives whole, so skip rows at or below it.
		console.log(`dump ${file.path}, resume after ${from ?? "genesis"}`);
	},
	onBatch: (events, envelope) => {
		console.log(`live page: ${events.length} events`);
		return envelope.next_cursor;
	},
});

console.log(`caught up at ${result.cursor} after ${result.pages} live pages`);
