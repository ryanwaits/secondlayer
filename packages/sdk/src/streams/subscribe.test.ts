import { describe, expect, test } from "bun:test";
import { ed25519 } from "@secondlayer/shared";
import { StreamsSignatureError } from "./errors.ts";
import { subscribeStreamsEvents } from "./subscribe.ts";
import type { FetchLike, StreamsEvent } from "./types.ts";

const { privateKeyPem, publicKeyPem } = ed25519.generateEd25519KeyPair();
const privateKey = ed25519.loadEd25519PrivateKey(privateKeyPem);

const EVENT = {
	cursor: "100:0",
	block_height: 100,
	block_hash: "0xb",
	burn_block_height: 200,
	tx_id: "0xtx",
	tx_index: 0,
	event_index: 0,
	event_type: "stx_transfer",
	contract_id: null,
	payload: { amount: "100", sender: "SP1", recipient: "SP2" },
	ts: "2026-06-05T00:00:00.000Z",
} as unknown as StreamsEvent;

function signedFrame(event: unknown, sig?: string): string {
	const signature =
		sig ?? ed25519.signEd25519(JSON.stringify(event), privateKey);
	const body = JSON.stringify({
		event,
		sig: signature,
		key_id: ed25519.ed25519KeyId(publicKeyPem),
	});
	return `data: ${body}\n\n`;
}

/** A fetch that streams `chunks` then stays open until the request is aborted,
 *  so the subscription doesn't reconnect-loop during the test. */
function sseFetch(chunks: string[]): FetchLike {
	return ((_url, init) => {
		const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const enc = new TextEncoder();
				for (const c of chunks) controller.enqueue(enc.encode(c));
				const close = () => {
					try {
						controller.close();
					} catch {
						// already closed
					}
				};
				if (signal?.aborted) close();
				else signal?.addEventListener("abort", close, { once: true });
			},
		});
		return Promise.resolve(
			new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
	}) as FetchLike;
}

const loadKey = async () => ({
	publicKey: ed25519.loadEd25519PublicKey(publicKeyPem),
});

describe("subscribeStreamsEvents", () => {
	test("delivers events and ignores ping frames", async () => {
		const got: StreamsEvent[] = [];
		let unsub = () => {};
		await new Promise<void>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				apiKey: "sk-sl_test",
				fetchImpl: sseFetch(["event: ping\ndata: \n\n", signedFrame(EVENT)]),
				verify: "off",
				loadKey,
				params: {
					onEvent: (e) => {
						got.push(e);
						resolve();
					},
				},
			});
		});
		unsub();
		expect(got).toHaveLength(1);
		expect((got[0] as { cursor: string }).cursor).toBe("100:0");
	});

	test("verify on: a valid inline signature passes through", async () => {
		const got: StreamsEvent[] = [];
		let unsub = () => {};
		await new Promise<void>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				apiKey: "sk-sl_test",
				fetchImpl: sseFetch([signedFrame(EVENT)]),
				verify: "strict",
				loadKey,
				params: {
					onEvent: (e) => {
						got.push(e);
						resolve();
					},
				},
			});
		});
		unsub();
		expect(got).toHaveLength(1);
		expect((got[0] as { cursor: string }).cursor).toBe("100:0");
	});

	test("lenient: an unsigned frame is delivered (self-host without a key)", async () => {
		const got: StreamsEvent[] = [];
		let unsub = () => {};
		// Frame carries no `sig` — what an unsigned self-host instance emits.
		const unsignedFrame = `data: ${JSON.stringify({ event: EVENT })}\n\n`;
		await new Promise<void>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				apiKey: "sk-sl_test",
				fetchImpl: sseFetch([unsignedFrame]),
				verify: "lenient",
				loadKey,
				params: {
					onEvent: (e) => {
						got.push(e);
						resolve();
					},
				},
			});
		});
		unsub();
		expect(got).toHaveLength(1);
	});

	test("lenient: a present-but-invalid signature still triggers onError", async () => {
		let unsub = () => {};
		const err = await new Promise<unknown>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				apiKey: "sk-sl_test",
				fetchImpl: sseFetch([signedFrame(EVENT, "not-a-real-signature")]),
				verify: "lenient",
				loadKey,
				reconnectDelayMs: 50,
				params: {
					onEvent: () => resolve(new Error("onEvent should not fire")),
					onError: (e) => resolve(e),
				},
			});
		});
		unsub();
		expect(err).toBeInstanceOf(StreamsSignatureError);
	});

	test("strict: a bad signature triggers onError, not onEvent", async () => {
		let unsub = () => {};
		const err = await new Promise<unknown>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				apiKey: "sk-sl_test",
				fetchImpl: sseFetch([signedFrame(EVENT, "not-a-real-signature")]),
				verify: "strict",
				loadKey,
				reconnectDelayMs: 50,
				params: {
					onEvent: () => resolve(new Error("onEvent should not fire")),
					onError: (e) => resolve(e),
				},
			});
		});
		unsub();
		expect(err).toBeInstanceOf(StreamsSignatureError);
	});
});
