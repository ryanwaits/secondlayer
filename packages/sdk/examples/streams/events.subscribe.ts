import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
	apiKey: process.env.SECONDLAYER_API_KEY,
});

const subscription = sl.streams.events.subscribe({
	types: ["print"],
	contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry",
	onEvent: (event) => {
		// !callout[/event_type/] Each event is a union until you check its type.
		if (event.event_type !== "print") return;
		console.log(event.cursor, event.payload.topic);
	},
	// !callout[/onError/] Transport errors reconnect from the last handled cursor; this just observes them.
	onError: (err) => console.error("subscription error", err),
});

// Calling the subscription unsubscribes.
process.on("SIGTERM", () => subscription());

// !callout[/done/] Settles when the loop ends, and rejects on an error a retry cannot fix.
await subscription.done;
