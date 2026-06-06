import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ed25519 } from "@secondlayer/shared";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "../streams/auth.ts";
import { StreamsResponseCache } from "../streams/response-cache.ts";
import { resetStreamsSignerForTest } from "../streams/signing.ts";
import type { StreamsTip } from "../streams/tip.ts";
import { createStreamsRouter } from "./streams.ts";

const TIP: StreamsTip = {
	block_height: 200,
	block_hash: "0xtip",
	burn_block_height: 300,
	finalized_height: 150,
	lag_seconds: 2,
};

const EVENT = {
	cursor: "100:0",
	block_height: 100,
	block_hash: "0xb100",
	burn_block_height: 250,
	tx_id: "0xtx",
	tx_index: 0,
	event_index: 0,
	event_type: "stx_transfer" as const,
	contract_id: null,
	payload: { amount: "100", sender: "SP1", recipient: "SP2" },
	ts: "2026-06-05T00:00:00.000Z",
};

const TOKENS: StreamsTokenStore = {
	get: () => ({
		tenant_id: "tenant_test",
		tier: "build",
		scopes: [STREAMS_READ_SCOPE],
	}),
};

const { privateKeyPem, publicKeyPem } = ed25519.generateEd25519KeyPair();

describe("GET /events/stream (SSE)", () => {
	const savedKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	beforeAll(() => {
		process.env.STREAMS_SIGNING_PRIVATE_KEY = privateKeyPem;
		resetStreamsSignerForTest();
	});
	afterAll(() => {
		process.env.STREAMS_SIGNING_PRIVATE_KEY = savedKey;
		resetStreamsSignerForTest();
	});

	test("pushes an inline-signed event frame that verifies", async () => {
		let calls = 0;
		const router = createStreamsRouter({
			tokens: TOKENS,
			getTip: () => TIP,
			// First poll returns one event; subsequent polls are empty (the loop
			// then heartbeats — we cancel before that matters).
			readEvents: async () => {
				calls += 1;
				return calls === 1
					? { events: [EVENT], next_cursor: EVENT.cursor }
					: { events: [], next_cursor: null };
			},
			readReorgs: async () => [],
			recordEventsReturned: async () => {},
			responseCache: new StreamsResponseCache(),
		});

		const res = await router.request("/events/stream", {
			headers: { authorization: "Bearer sk-sl_test" },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		if (!res.body) throw new Error("no body");

		// Read the first SSE data frame, then cancel to end the poll loop.
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let dataLine: string | undefined;
		for (let i = 0; i < 20 && dataLine === undefined; i++) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			dataLine = buffer
				.split("\n")
				.find((line) => line.startsWith("data: ") && line.length > 6);
		}
		await reader.cancel();
		if (!dataLine) throw new Error("no data frame received");

		const frame = JSON.parse(dataLine.slice("data: ".length)) as {
			event: typeof EVENT & { finalized: boolean };
			sig: string;
			key_id: string;
		};
		expect(frame.event.cursor).toBe("100:0");
		expect(frame.event.finalized).toBe(true); // block 100 <= finalized 150
		expect(frame.key_id).toBe(ed25519.ed25519KeyId(publicKeyPem));
		expect(
			ed25519.verifyEd25519(
				JSON.stringify(frame.event),
				frame.sig,
				ed25519.loadEd25519PublicKey(publicKeyPem),
			),
		).toBe(true);
	});
});
