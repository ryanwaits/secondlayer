import { describe, expect, test } from "bun:test";
import { ed25519 } from "@secondlayer/shared";
import { AuthError, RateLimitError, StreamsSignatureError } from "./errors.ts";
import {
	SUBSCRIBE_MAX_RECONNECT_DELAY_MS,
	reconnectDelay,
	subscribeStreamsEvents,
} from "./subscribe.ts";
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
	keyId: ed25519.ed25519KeyId(publicKeyPem),
	publicKey: ed25519.loadEd25519PublicKey(publicKeyPem),
});

describe("subscribeStreamsEvents", () => {
	test("delivers events and ignores ping frames", async () => {
		const got: StreamsEvent[] = [];
		let unsub = () => {};
		await new Promise<void>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				headers: { Authorization: "Bearer sk-sl_test" },
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
				headers: { Authorization: "Bearer sk-sl_test" },
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
				headers: { Authorization: "Bearer sk-sl_test" },
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
				headers: { Authorization: "Bearer sk-sl_test" },
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
				headers: { Authorization: "Bearer sk-sl_test" },
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

	test("a frame signed by a rotated key refreshes the key once and delivers", async () => {
		const rotated = ed25519.generateEd25519KeyPair();
		const rotatedPriv = ed25519.loadEd25519PrivateKey(rotated.privateKeyPem);
		const rotatedId = ed25519.ed25519KeyId(rotated.publicKeyPem);
		const frame = `data: ${JSON.stringify({
			event: EVENT,
			sig: ed25519.signEd25519(JSON.stringify(EVENT), rotatedPriv),
			key_id: rotatedId,
		})}\n\n`;
		const asked: Array<string | null | undefined> = [];
		const got: StreamsEvent[] = [];
		let unsub = () => {};
		await new Promise<void>((resolve) => {
			unsub = subscribeStreamsEvents({
				baseUrl: "https://streams.example",
				fetchImpl: sseFetch([frame]),
				verify: "strict",
				// Stands in for the client's key resolver: the id the frame names
				// is handed over, and the resolver answers with that key.
				loadKey: async (keyId) => {
					asked.push(keyId);
					return {
						keyId: rotatedId,
						publicKey: ed25519.loadEd25519PublicKey(rotated.publicKeyPem),
					};
				},
				params: {
					onEvent: (e) => {
						got.push(e);
						resolve();
					},
					onError: (e) => resolve(Promise.reject(e) as never),
				},
			});
		});
		unsub();
		expect(asked).toEqual([rotatedId]);
		expect(got).toHaveLength(1);
	});

	test("an event whose handler throws is delivered again after reconnect", async () => {
		const frames = ["10:0", "10:1", "10:2"].map(
			(cursor) =>
				`data: ${JSON.stringify({ event: { ...EVENT, cursor } })}\n\n`,
		);
		const urls: string[] = [];
		const delivered: string[] = [];
		let first = true;
		// First connection streams three events then closes; every later
		// connection stays open so the test ends on unsubscribe.
		const fetchImpl: FetchLike = (url, init) => {
			urls.push(String(url));
			if (first) {
				first = false;
				return Promise.resolve(
					new Response(
						new ReadableStream<Uint8Array>({
							start(c) {
								for (const f of frames) c.enqueue(new TextEncoder().encode(f));
								c.close();
							},
						}),
						{ status: 200 },
					),
				);
			}
			return sseFetch([])(url, init);
		};
		const errors: unknown[] = [];
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl,
			verify: "off",
			loadKey,
			reconnectDelayMs: 5,
			random: () => 1,
			params: {
				fromCursor: "9:0",
				onEvent: (e) => {
					const cursor = (e as { cursor: string }).cursor;
					if (cursor === "10:1" && !delivered.includes("10:1:failed")) {
						delivered.push("10:1:failed");
						throw new Error("db insert failed");
					}
					delivered.push(cursor);
				},
				onError: (e) => errors.push(e),
			},
		});
		await new Promise((r) => setTimeout(r, 60));
		sub();
		await sub.done;
		expect(delivered.slice(0, 2)).toEqual(["10:0", "10:1:failed"]);
		// Resume is exclusive of the cursor, so the reconnect asks from the
		// last event the handler took, and 10:1 comes back.
		expect(urls[1]).toContain("from_cursor=10%3A0");
		expect(errors).toHaveLength(1);
	});

	test("a 401 ends the subscription with AuthError instead of reconnecting", async () => {
		let calls = 0;
		const fetchImpl: FetchLike = () => {
			calls++;
			return Promise.resolve(
				new Response(
					JSON.stringify({ error: "bad key", code: "UNAUTHORIZED" }),
					{
						status: 401,
					},
				),
			);
		};
		const errors: unknown[] = [];
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl,
			verify: "off",
			loadKey,
			reconnectDelayMs: 1,
			params: { onEvent: () => {}, onError: (e) => errors.push(e) },
		});
		await expect(sub.done).rejects.toBeInstanceOf(AuthError);
		await new Promise((r) => setTimeout(r, 30));
		expect(calls).toBe(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as AuthError).code).toBe("UNAUTHORIZED");
	});

	test("a bad signature ends the subscription and rejects done", async () => {
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl: sseFetch([signedFrame(EVENT, "not-a-real-signature")]),
			verify: "lenient",
			loadKey,
			reconnectDelayMs: 1,
			params: { onEvent: () => {} },
		});
		await expect(sub.done).rejects.toBeInstanceOf(StreamsSignatureError);
	});

	test("unsubscribing resolves done", async () => {
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl: sseFetch([]),
			verify: "off",
			loadKey,
			params: { onEvent: () => {} },
		});
		sub();
		await expect(sub.done).resolves.toBeUndefined();
	});

	test("reconnect delay doubles per failure, caps at 30 s, and never undercuts Retry-After", () => {
		const noJitter = () => 1;
		expect(reconnectDelay(0, 1000, undefined, noJitter)).toBe(1000);
		expect(reconnectDelay(1, 1000, undefined, noJitter)).toBe(2000);
		expect(reconnectDelay(4, 1000, undefined, noJitter)).toBe(16000);
		expect(reconnectDelay(10, 1000, undefined, noJitter)).toBe(
			SUBSCRIBE_MAX_RECONNECT_DELAY_MS,
		);
		// Jitter scales down to half, never up.
		expect(reconnectDelay(0, 1000, undefined, () => 0)).toBe(500);
		expect(reconnectDelay(0, 1000, 5, () => 0)).toBe(5000);
	});

	test("a clean server close backs off before reconnecting and a frame resets it", async () => {
		const stamps: number[] = [];
		let calls = 0;
		const fetchImpl: FetchLike = (url, init) => {
			stamps.push(Date.now());
			calls++;
			// Three immediate closes, then a connection that delivers a frame
			// and closes, then one that stays open.
			if (calls <= 4) {
				const chunks = calls === 4 ? [signedFrame(EVENT)] : [];
				return Promise.resolve(
					new Response(
						new ReadableStream<Uint8Array>({
							start(c) {
								for (const f of chunks) c.enqueue(new TextEncoder().encode(f));
								c.close();
							},
						}),
						{ status: 200 },
					),
				);
			}
			return sseFetch([])(url, init);
		};
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl,
			verify: "off",
			loadKey,
			reconnectDelayMs: 20,
			random: () => 1,
			params: { onEvent: () => {} },
		});
		while (calls < 5) await new Promise((r) => setTimeout(r, 5));
		sub();
		await sub.done;
		const gaps = stamps.slice(1).map((t, i) => t - (stamps[i] as number));
		// 20, 40, 80 (growing), then 20 again after the frame reset the count.
		expect(gaps[0] as number).toBeGreaterThanOrEqual(15);
		expect(gaps[1] as number).toBeGreaterThan(gaps[0] as number);
		expect(gaps[2] as number).toBeGreaterThan(gaps[1] as number);
		expect(gaps[3] as number).toBeLessThan(gaps[2] as number);
	});

	test("a 429 with Retry-After waits at least that long before reconnecting", async () => {
		const stamps: number[] = [];
		const errors: unknown[] = [];
		const fetchImpl: FetchLike = (url, init) => {
			stamps.push(Date.now());
			if (stamps.length === 1) {
				return Promise.resolve(
					new Response("{}", {
						status: 429,
						headers: { "Retry-After": "0.1" },
					}),
				);
			}
			return sseFetch([])(url, init);
		};
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl,
			verify: "off",
			loadKey,
			reconnectDelayMs: 1,
			params: { onEvent: () => {}, onError: (e) => errors.push(e) },
		});
		while (stamps.length < 2) await new Promise((r) => setTimeout(r, 5));
		sub();
		await sub.done;
		expect(errors[0]).toBeInstanceOf(RateLimitError);
		expect(
			(stamps[1] as number) - (stamps[0] as number),
		).toBeGreaterThanOrEqual(95);
	});

	test("a half-open connection reconnects once staleAfterMs passes with no frame", async () => {
		let calls = 0;
		const errors: unknown[] = [];
		// A body that never emits and never closes: what a NAT-dropped socket
		// looks like from the client.
		const fetchImpl: FetchLike = () => {
			calls++;
			return Promise.resolve(
				new Response(new ReadableStream<Uint8Array>({ start() {} }), {
					status: 200,
				}),
			);
		};
		const sub = subscribeStreamsEvents({
			baseUrl: "https://streams.example",
			fetchImpl,
			verify: "off",
			loadKey,
			reconnectDelayMs: 1,
			staleAfterMs: 30,
			params: { onEvent: () => {}, onError: (e) => errors.push(e) },
		});
		while (calls < 2) await new Promise((r) => setTimeout(r, 5));
		sub();
		await sub.done;
		expect(calls).toBeGreaterThanOrEqual(2);
		expect((errors[0] as { code?: string }).code).toBe("STREAM_STALE");
		expect((errors[0] as { retryable?: boolean }).retryable).toBe(true);
	});
});
