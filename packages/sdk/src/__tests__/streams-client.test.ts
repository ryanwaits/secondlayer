import { describe, expect, test } from "bun:test";
import { ed25519 } from "@secondlayer/shared";
import {
	AuthError,
	RateLimitError,
	type StreamsEvent,
	StreamsServerError,
	StreamsSignatureError,
	ValidationError,
	createStreamsClient,
} from "../index.ts";

const TIP = {
	block_height: 10,
	block_hash: "0x01",
	burn_block_height: 20,
	lag_seconds: 0,
};

function jsonResponse(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function event(cursor: string, index: number): StreamsEvent {
	return {
		cursor,
		block_height: 1,
		block_hash: TIP.block_hash,
		burn_block_height: TIP.burn_block_height,
		tx_id: `0x${index}`,
		tx_index: index,
		event_index: index,
		event_type: "ft_transfer",
		contract_id: "SP1.token",
		payload: {
			asset_identifier: "SP1.token::token",
			sender: "SP1",
			recipient: "SP2",
			amount: "1",
		},
		ts: "2026-05-02T21:43:00.000Z",
	};
}

describe("createStreamsClient", () => {
	test("lists events with typed query params and auth", async () => {
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		await client.events.list({
			cursor: "1:0",
			fromHeight: 1,
			toHeight: 2,
			types: ["ft_transfer"],
			contractId: "SP1.token",
			limit: 10,
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.pathname).toBe("/v1/streams/events");
		expect(url.searchParams.get("cursor")).toBe("1:0");
		expect(url.searchParams.get("from_height")).toBe("1");
		expect(url.searchParams.get("to_height")).toBe("2");
		expect(url.searchParams.get("types")).toBe("ft_transfer");
		expect(url.searchParams.get("contract_id")).toBe("SP1.token");
		expect(url.searchParams.get("limit")).toBe("10");
		expect(requests[0]?.headers.get("Authorization")).toBe("Bearer sk-test");
	});

	test("serializes not_types and list filters as comma-separated params", async () => {
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		await client.events.list({
			notTypes: ["print"],
			contractId: ["SP1.a", "SP2.b"],
			sender: ["SP1", "SP2"],
			recipient: "SP3",
		});

		const url = new URL(requests[0]?.url ?? "");
		expect(url.searchParams.get("not_types")).toBe("print");
		expect(url.searchParams.get("contract_id")).toBe("SP1.a,SP2.b");
		expect(url.searchParams.get("sender")).toBe("SP1,SP2");
		expect(url.searchParams.get("recipient")).toBe("SP3");
	});

	test("builds convenience endpoint URLs with auth", async () => {
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				const request =
					input instanceof Request
						? input
						: new Request(input.toString(), init);
				requests.push(request);
				if (request.url.includes("/canonical/100")) {
					return jsonResponse({
						block_height: 100,
						block_hash: "0x01",
						burn_block_height: 200,
						burn_block_hash: null,
						is_canonical: true,
					});
				}
				if (request.url.includes("/reorgs")) {
					return jsonResponse({ reorgs: [], next_since: null });
				}
				return jsonResponse({ events: [], tip: TIP, reorgs: [] });
			},
		});

		await client.canonical(100);
		await client.events.byTxId("0xtx");
		await client.blocks.events("0xblock");
		await client.reorgs.list({ since: "2026-05-03T00:00:00.000Z", limit: 5 });

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/v1/streams/canonical/100",
			"/v1/streams/events/0xtx",
			"/v1/streams/blocks/0xblock/events",
			"/v1/streams/reorgs",
		]);
		expect(new URL(requests[3]?.url ?? "").searchParams.get("limit")).toBe("5");
		expect(
			requests.every(
				(request) => request.headers.get("Authorization") === "Bearer sk-test",
			),
		).toBe(true);
	});

	test("maps 401 to AuthError", async () => {
		const client = createStreamsClient({
			apiKey: "bad",
			fetchImpl: async () => jsonResponse({ error: "API key invalid" }, 401),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(AuthError);
	});

	test("maps 429 to RateLimitError with retry-after", async () => {
		const client = createStreamsClient({
			apiKey: "limited",
			fetchImpl: async () =>
				jsonResponse({ error: "too many" }, 429, { "Retry-After": "3" }),
		});

		try {
			await client.events.list();
			throw new Error("expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(RateLimitError);
			expect((error as RateLimitError).retryAfter).toBe("3");
		}
	});

	test("a 4xx keeps the server's code so callers branch on it", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async () =>
				jsonResponse(
					{ error: "cursor is not valid", code: "CURSOR_INVALID" },
					400,
				),
		});
		try {
			await client.events.list({ cursor: "nope" });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ValidationError);
			expect((err as ValidationError).code).toBe("CURSOR_INVALID");
			expect((err as ValidationError).shortMessage).toBe("cursor is not valid");
			expect((err as ValidationError).body).toEqual({
				error: "cursor is not valid",
				code: "CURSOR_INVALID",
			});
		}
	});

	test("a 401 and a 5xx keep the server's code too", async () => {
		const at = (status: number, code: string) =>
			createStreamsClient({
				baseUrl: "http://secondlayer.test",
				fetchImpl: async () => jsonResponse({ error: "why", code }, status),
			});
		await expect(at(401, "TOKEN_REVOKED").tip()).rejects.toMatchObject({
			name: "AuthError",
			code: "TOKEN_REVOKED",
		});
		await expect(at(503, "INDEX_NOT_READY").tip()).rejects.toMatchObject({
			name: "StreamsServerError",
			code: "INDEX_NOT_READY",
			retryable: true,
		});
	});

	test("maps 400 to ValidationError", async () => {
		const client = createStreamsClient({
			apiKey: "bad-request",
			fetchImpl: async () => jsonResponse({ error: "bad cursor" }, 400),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(ValidationError);
	});

	test("maps 500 to StreamsServerError", async () => {
		const client = createStreamsClient({
			apiKey: "server-error",
			fetchImpl: async () => jsonResponse({ error: "down" }, 500),
		});

		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsServerError,
		);
	});

	test("stream yields paginated events in order", async () => {
		const pages = [
			{
				events: [event("1:0", 0), event("1:1", 1)],
				next_cursor: "1:1",
				tip: TIP,
				reorgs: [],
			},
			{ events: [event("1:2", 2)], next_cursor: "1:2", tip: TIP, reorgs: [] },
		];
		const requestedCursors: Array<string | null> = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async (input) => {
				const url = new URL(input.toString());
				requestedCursors.push(url.searchParams.get("cursor"));
				return jsonResponse(pages.shift());
			},
		});
		const seen: string[] = [];

		for await (const item of client.events.stream({ batchSize: 2 })) {
			seen.push(item.cursor);
			if (seen.length === 3) break;
		}

		expect(seen).toEqual(["1:0", "1:1", "1:2"]);
		expect(requestedCursors).toEqual([null, "1:1"]);
	});

	test("stream forwards the labelled filters map to the wire", async () => {
		// Regression: stream() declared `filters` but never forwarded it, so a
		// labelled caller got the FULL unfiltered firehose — billed per row.
		const requests: Request[] = [];
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "http://secondlayer.test",
			fetchImpl: async (input, init) => {
				requests.push(
					input instanceof Request
						? input
						: new Request(input.toString(), init),
				);
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});

		const filters = {
			sbtc: { types: ["ft_transfer"], assetIdentifier: "SP1.t::t" },
		} as const;
		for await (const _ of client.events.stream({
			filters,
			maxEmptyPolls: 1,
		})) {
			// drains immediately: single empty page
		}

		const url = new URL(requests[0]?.url ?? "");
		expect(url.searchParams.get("filters")).toBe(JSON.stringify(filters));
	});

	test("stream terminates cleanly when aborted during empty-page backoff", async () => {
		const controller = new AbortController();
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				controller.abort();
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});
		const seen: StreamsEvent[] = [];

		for await (const item of client.events.stream({
			batchSize: 10,
			signal: controller.signal,
		})) {
			seen.push(item);
		}

		expect(seen).toEqual([]);
	});

	test("stream stops at maxPages", async () => {
		const pages = [
			{ events: [event("1:0", 0)], next_cursor: "1:0", tip: TIP, reorgs: [] },
			{ events: [event("1:1", 1)], next_cursor: "1:1", tip: TIP, reorgs: [] },
		];
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => jsonResponse(pages.shift()),
		});
		const seen: string[] = [];

		for await (const item of client.events.stream({
			batchSize: 1,
			maxPages: 1,
		})) {
			seen.push(item.cursor);
		}

		expect(seen).toEqual(["1:0"]);
		expect(pages).toHaveLength(1);
	});

	test("stream stops at maxEmptyPolls", async () => {
		let requests = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			fetchImpl: async () => {
				requests++;
				return jsonResponse({
					events: [],
					next_cursor: null,
					tip: TIP,
					reorgs: [],
				});
			},
		});
		const seen: StreamsEvent[] = [];

		for await (const item of client.events.stream({
			batchSize: 10,
			emptyBackoffMs: 0,
			maxEmptyPolls: 2,
		})) {
			seen.push(item);
		}

		expect(seen).toEqual([]);
		expect(requests).toBe(2);
	});
});

describe("createStreamsClient verify", () => {
	const { privateKeyPem, publicKeyPem } = ed25519.generateEd25519KeyPair();
	const priv = ed25519.loadEd25519PrivateKey(privateKeyPem);
	const envelope = {
		events: [],
		next_cursor: null,
		tip: TIP,
		reorgs: [],
	};

	function signedResponse(body: string, signature: string): Response {
		return new Response(body, {
			status: 200,
			headers: { "Content-Type": "application/json", "X-Signature": signature },
		});
	}

	test("accepts a valid signature over the exact body", async () => {
		const body = JSON.stringify(envelope);
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: { publicKey: publicKeyPem },
			fetchImpl: async () =>
				signedResponse(body, ed25519.signEd25519(body, priv)),
		});
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
	});

	test("rejects a tampered body", async () => {
		const body = JSON.stringify(envelope);
		const signature = ed25519.signEd25519(body, priv);
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: { publicKey: publicKeyPem },
			// Return a different body than what was signed.
			fetchImpl: async () =>
				signedResponse(JSON.stringify({ ...envelope, reorgs: [1] }), signature),
		});
		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("throws when the signature header is missing", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: { publicKey: publicKeyPem },
			fetchImpl: async () =>
				new Response(JSON.stringify(envelope), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		});
		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("does not verify when explicitly disabled (verify: false)", async () => {
		const body = JSON.stringify(envelope);
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: false,
			// Tampered signature present, but verification is off → still resolves.
			fetchImpl: async () => signedResponse(body, "not-a-real-signature"),
		});
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
	});

	// Default (verify omitted) is LENIENT: verify when the server signs, pass
	// through when it doesn't — so the hosted API is verified by default without
	// breaking unsigned self-host deployments.
	test("default lenient: passes through an unsigned response", async () => {
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			fetchImpl: async () =>
				new Response(JSON.stringify(envelope), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		});
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
	});

	test("default lenient: verifies a signed response via the key endpoint", async () => {
		const body = JSON.stringify(envelope);
		const keyId = ed25519.ed25519KeyId(publicKeyPem);
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			// no `verify` → lenient default
			fetchImpl: async (input) =>
				String(input).endsWith("/public/streams/signing-key")
					? new Response(
							JSON.stringify({
								algorithm: "ed25519",
								key_id: keyId,
								public_key_pem: publicKeyPem,
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } },
						)
					: new Response(body, {
							status: 200,
							headers: {
								"Content-Type": "application/json",
								"X-Signature": ed25519.signEd25519(body, priv),
								"X-Signature-KeyId": keyId,
							},
						}),
		});
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
	});

	test("default lenient: rejects a present-but-invalid signature", async () => {
		const body = JSON.stringify(envelope);
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			// no `verify` → lenient, but a present signature must still verify.
			fetchImpl: async (input) =>
				String(input).endsWith("/public/streams/signing-key")
					? new Response(
							JSON.stringify({
								algorithm: "ed25519",
								key_id: ed25519.ed25519KeyId(publicKeyPem),
								public_key_pem: publicKeyPem,
							}),
							{ status: 200, headers: { "Content-Type": "application/json" } },
						)
					: // Signature over a different body than what's returned → invalid.
						signedResponse(body, ed25519.signEd25519(`${body} `, priv)),
		});
		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});
});

describe("createStreamsClient verify key rotation", () => {
	const envelope = { events: [], next_cursor: null, tip: TIP, reorgs: [] };
	const body = JSON.stringify(envelope);

	type ServerKey = {
		priv: ReturnType<typeof ed25519.loadEd25519PrivateKey>;
		keyId: string;
		pem: string;
	};
	function serverKey(): ServerKey {
		const { privateKeyPem, publicKeyPem } = ed25519.generateEd25519KeyPair();
		return {
			priv: ed25519.loadEd25519PrivateKey(privateKeyPem),
			keyId: ed25519.ed25519KeyId(publicKeyPem),
			pem: publicKeyPem,
		};
	}

	function signingKeyResponse(key: ServerKey): Response {
		return new Response(
			JSON.stringify({
				algorithm: "ed25519",
				key_id: key.keyId,
				public_key_pem: key.pem,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}

	function dataResponse(key: ServerKey): Response {
		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"X-Signature": ed25519.signEd25519(body, key.priv),
				"X-Signature-KeyId": key.keyId,
			},
		});
	}

	test("refreshes the cached key when the server rotates", async () => {
		const keyA = serverKey();
		const keyB = serverKey();
		let current = keyA;
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: true,
			fetchImpl: async (input) =>
				String(input).endsWith("/public/streams/signing-key")
					? signingKeyResponse(current)
					: dataResponse(current),
		});

		// First request caches key A.
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
		// Rotate the server; the SDK should detect the new key id and refetch.
		current = keyB;
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
	});

	test("fails closed when the rotated key id is not served", async () => {
		const served = serverKey();
		const rogue = serverKey();
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: true,
			// Endpoint serves `served`, but the response is signed by `rogue` and
			// claims its id — one refetch still won't match, so fail closed.
			fetchImpl: async (input) =>
				String(input).endsWith("/public/streams/signing-key")
					? signingKeyResponse(served)
					: dataResponse(rogue),
		});
		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("rejects a rotated key id in pinned mode", async () => {
		const pinned = serverKey();
		const rotated = serverKey();
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: { publicKey: pinned.pem },
			fetchImpl: async () => dataResponse(rotated),
		});
		await expect(client.events.list()).rejects.toBeInstanceOf(
			StreamsSignatureError,
		);
	});

	test("a failed key fetch is retryable and the next read fetches the key again", async () => {
		const key = serverKey();
		let keyFetches = 0;
		const client = createStreamsClient({
			apiKey: "sk-test",
			baseUrl: "https://secondlayer.test",
			verify: true,
			fetchImpl: async (input) => {
				if (String(input).endsWith("/public/streams/signing-key")) {
					keyFetches++;
					return keyFetches === 1
						? new Response("upstream down", { status: 503 })
						: signingKeyResponse(key);
				}
				return dataResponse(key);
			},
		});
		await expect(client.events.list()).rejects.toMatchObject({
			name: "StreamsServerError",
			retryable: true,
			status: 503,
		});
		await expect(client.events.list()).resolves.toMatchObject({
			next_cursor: null,
		});
		expect(keyFetches).toBe(2);
		// The good key stays cached.
		await client.events.list();
		expect(keyFetches).toBe(2);
	});

	test("a dropped socket on the key fetch is retryable, not a signature failure", async () => {
		const key = serverKey();
		let first = true;
		const client = createStreamsClient({
			baseUrl: "https://secondlayer.test",
			verify: true,
			fetchImpl: async (input) => {
				if (String(input).endsWith("/public/streams/signing-key")) {
					if (first) {
						first = false;
						throw new TypeError("fetch failed");
					}
					return signingKeyResponse(key);
				}
				return dataResponse(key);
			},
		});
		await expect(client.tip()).rejects.toMatchObject({
			name: "StreamsServerError",
			code: "SIGNING_KEY_UNAVAILABLE",
			retryable: true,
		});
		await expect(client.tip()).resolves.toMatchObject({ next_cursor: null });
	});
});

describe("createStreamsClient strict verify over plain http", () => {
	test("refuses an unpinned strict client for a non-loopback http base", () => {
		expect(() =>
			createStreamsClient({
				baseUrl: "http://10.0.0.5:3800",
				verify: true,
				fetchImpl: async () => jsonResponse({}),
			}),
		).toThrow(ValidationError);
		expect(() =>
			createStreamsClient({
				baseUrl: "http://secondlayer.test",
				verify: true,
				fetchImpl: async () => jsonResponse({}),
			}),
		).toThrow(/publicKey/);
	});

	test("accepts strict over http on loopback, over https anywhere, and pinned anywhere", () => {
		const { publicKeyPem } = ed25519.generateEd25519KeyPair();
		const fetchImpl = async () => jsonResponse({});
		for (const baseUrl of [
			"http://127.0.0.1:3800",
			"http://localhost:3800",
			"http://[::1]:3800",
			"https://secondlayer.test",
		]) {
			expect(() =>
				createStreamsClient({ baseUrl, verify: true, fetchImpl }),
			).not.toThrow();
		}
		expect(() =>
			createStreamsClient({
				baseUrl: "http://10.0.0.5:3800",
				verify: { publicKey: publicKeyPem },
				fetchImpl,
			}),
		).not.toThrow();
		// Lenient (the default) is unchanged: it never fetches a key unless the
		// server signs, so plain http stays usable for a self-host without a key.
		expect(() =>
			createStreamsClient({ baseUrl: "http://10.0.0.5:3800", fetchImpl }),
		).not.toThrow();
	});
});
