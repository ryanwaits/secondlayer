import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();

const { results } = await sl.batch([
	{ path: "/v1/streams/tip" },
	{ path: "/v1/index/pox5/events", params: { topic: "stake", limit: 5 } },
]);

for (const result of results) {
	// !callout[/status/] Each item has its own status, so one failed read does not fail the batch.
	console.log(result.path, result.status);
}
