import { describe, expect, test } from "bun:test";
import {
	BitcoinRpcError,
	BitcoinRpcTransportError,
	bitcoinRpcCall,
	bitcoinRpcConfigFromEnv,
} from "../rpc.ts";

type Seen = { url: string; init: RequestInit };

function fetchReturning(
	respond: (init: RequestInit) => Response | Promise<Response>,
) {
	const seen: Seen[] = [];
	const fn = (async (url: string, init: RequestInit) => {
		seen.push({ url, init });
		return respond(init);
	}) as unknown as typeof fetch;
	return { fn, seen };
}

async function failureOf(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(BitcoinRpcTransportError);
		return error as BitcoinRpcTransportError;
	}
	throw new Error("expected rejection");
}

describe("bitcoinRpcCall", () => {
	test("returns result and sends a JSON-RPC 1.0 body with Basic auth", async () => {
		const { fn, seen } = fetchReturning(() =>
			Response.json({ result: 42, error: null }),
		);
		const call = bitcoinRpcCall(
			{
				url: "http://bitcoind.test",
				auth: { username: "u", password: "p" },
				fetch: fn,
			},
			{ id: "test-id" },
		);
		expect(await call<number>("getblockcount", [1, "x"])).toBe(42);
		const body = JSON.parse(seen[0]?.init.body as string);
		expect(body).toEqual({
			jsonrpc: "1.0",
			id: "test-id",
			method: "getblockcount",
			params: [1, "x"],
		});
		const headers = seen[0]?.init.headers as Record<string, string>;
		expect(headers.authorization).toBe(`Basic ${btoa("u:p")}`);
	});

	test("a string auth is sent verbatim and no auth sends no header", async () => {
		const { fn, seen } = fetchReturning(() =>
			Response.json({ result: null, error: null }),
		);
		await bitcoinRpcCall({ url: "http://b.test", auth: "PRE==", fetch: fn })(
			"m",
			[],
		);
		await bitcoinRpcCall({ url: "http://b.test", fetch: fn })("m", []);
		const first = seen[0]?.init.headers as Record<string, string>;
		const second = seen[1]?.init.headers as Record<string, string>;
		expect(first.authorization).toBe("Basic PRE==");
		expect("authorization" in second).toBe(false);
	});

	test("an HTTP 500 carrying a JSON-RPC error body throws BitcoinRpcError", async () => {
		const { fn } = fetchReturning(
			() =>
				new Response(
					JSON.stringify({
						result: null,
						error: {
							code: -5,
							message: "No such mempool or blockchain transaction",
						},
					}),
					{ status: 500 },
				),
		);
		const call = bitcoinRpcCall({ url: "http://b.test", fetch: fn });
		try {
			await call("getrawtransaction", ["x"]);
			throw new Error("expected rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(BitcoinRpcError);
			expect((error as BitcoinRpcError).code).toBe(-5);
			expect((error as BitcoinRpcError).method).toBe("getrawtransaction");
		}
	});

	test("an HTTP 503 with a non-JSON body is an http failure with the status", async () => {
		const { fn } = fetchReturning(
			() => new Response("upstream down", { status: 503 }),
		);
		const err = await failureOf(
			bitcoinRpcCall({ url: "http://b.test", fetch: fn })("m", []),
		);
		expect(err.failure).toBe("http");
		expect(err.status).toBe(503);
	});

	test("an HTTP 200 body without a result key is a bad-body failure", async () => {
		const { fn } = fetchReturning(() => Response.json({}));
		const err = await failureOf(
			bitcoinRpcCall({ url: "http://b.test", fetch: fn })("m", []),
		);
		expect(err.failure).toBe("bad-body");
	});

	test("a rejected fetch is a network failure whose message leaks neither URL nor credentials", async () => {
		const { fn } = fetchReturning(() => {
			throw new Error("connect ECONNREFUSED http://user:secret@host:8332");
		});
		const err = await failureOf(
			bitcoinRpcCall({ url: "http://b.test", fetch: fn })("m", []),
		);
		expect(err.failure).toBe("network");
		expect(err.message).not.toContain("secret");
		expect(err.message).not.toContain("host");
	});

	test("a fired timeout signal is a timeout failure", async () => {
		const { fn } = fetchReturning(
			(init) =>
				new Promise<Response>((_, reject) => {
					if (init.signal?.aborted) reject(new Error("aborted"));
				}),
		);
		const call = bitcoinRpcCall(
			{ url: "http://b.test", fetch: fn, timeoutMs: 5 },
			{ timeoutSignal: () => AbortSignal.abort() },
		);
		expect((await failureOf(call("m", []))).failure).toBe("timeout");
	});

	test("an already-aborted caller signal is an aborted failure", async () => {
		const { fn } = fetchReturning(
			(init) =>
				new Promise<Response>((_, reject) => {
					if (init.signal?.aborted) reject(new Error("aborted"));
				}),
		);
		const call = bitcoinRpcCall({ url: "http://b.test", fetch: fn });
		const err = await failureOf(call("m", [], { signal: AbortSignal.abort() }));
		expect(err.failure).toBe("aborted");
	});
});

describe("bitcoinRpcConfigFromEnv", () => {
	test("unset or blank URL gives undefined", () => {
		expect(bitcoinRpcConfigFromEnv({})).toBeUndefined();
		expect(bitcoinRpcConfigFromEnv({ BITCOIN_RPC_URL: "  " })).toBeUndefined();
	});

	test("the URL is trimmed", () => {
		expect(
			bitcoinRpcConfigFromEnv({ BITCOIN_RPC_URL: " http://b.test " }),
		).toEqual({
			url: "http://b.test",
		});
	});

	test("BITCOIN_RPC_AUTH wins over username and password", () => {
		expect(
			bitcoinRpcConfigFromEnv({
				BITCOIN_RPC_URL: "http://b.test",
				BITCOIN_RPC_AUTH: "PRE==",
				BITCOIN_RPC_USERNAME: "u",
				BITCOIN_RPC_PASSWORD: "p",
			}),
		).toEqual({ url: "http://b.test", auth: "PRE==" });
	});

	test("username and password together become an auth object", () => {
		expect(
			bitcoinRpcConfigFromEnv({
				BITCOIN_RPC_URL: "http://b.test",
				BITCOIN_RPC_USERNAME: "u",
				BITCOIN_RPC_PASSWORD: "p",
			}),
		).toEqual({ url: "http://b.test", auth: { username: "u", password: "p" } });
	});

	test("a username without a password sets no auth", () => {
		const config = bitcoinRpcConfigFromEnv({
			BITCOIN_RPC_URL: "http://b.test",
			BITCOIN_RPC_USERNAME: "u",
		});
		expect(config).toBeDefined();
		expect(config && "auth" in config).toBe(false);
	});
});
