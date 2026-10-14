import { SecondLayer } from "@secondlayer/sdk";

const id = process.argv[2];
if (!id) throw new Error("usage: bun replay.ts <webhook id>");

const sl = new SecondLayer({
	apiKey: process.env.SECONDLAYER_API_KEY,
});
const range = { fromBlock: 8_000_000, toBlock: 8_050_000 };

const first = await sl.webhooks.replay(id, range);
console.log(first.replayId, first.scannedCount, first.enqueuedCount);

// !callout[/force/] The same range twice is a no-op. Pass any string as `force` to re-deliver it.
const again = await sl.webhooks.replay(id, { ...range, force: "retry-1" });
console.log(again.replayId);
