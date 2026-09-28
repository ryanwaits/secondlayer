// Unit tests for `bitcoinRpcClient`'s timeout + retry behavior (plan 076),
// against an injected `fetch` — no real network, no Docker (see
// `test/regtest/run.ts` for a real-node proof). The injected `sleep` records
// requested backoff durations without actually waiting, so retry assertions
// run instantly; `timeoutSignal` records the ms a call requested without
// depending on a real timer firing.
import { describe, expect, test } from "bun:test";
import { BitcoinRpcError, bitcoinRpcClient } from "./rpc.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function recordingSleep(): {
	sleep: (ms: number) => Promise<void>;
	calls: number[];
} {
	const calls: number[] = [];
	return { sleep: async (ms: number) => void calls.push(ms), calls };
}

describe("bitcoinRpcClient timeout", () => {
	test("a hung fetch aborts at the timeout instead of hanging forever", async () => {
		// The fake fetch never resolves on its own — only the AbortSignal firing
		// settles it, exactly like a real `fetch` under a stuck bitcoind/socket.
		let fetchCalls = 0;
		const fakeFetch = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				fetchCalls += 1;
				const signal = init?.signal as AbortSignal;
				signal.addEventListener("abort", () => reject(signal.reason));
			})) as unknown as typeof fetch;
		const { sleep, calls } = recordingSleep();
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: fakeFetch,
			timeoutMs: 5,
			sleep,
		});

		await expect(client.getblockcount()).rejects.toThrow();

		// It retried (didn't just hang) and eventually gave up.
		expect(fetchCalls).toBe(6); // 1 initial + 5 retries
		expect(calls.length).toBe(5);
	});

	test("waitfornewblock's fetch timeout is timeoutMs + 10s", async () => {
		const seenTimeouts: number[] = [];
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: (async () =>
				jsonResponse({
					result: { hash: "h", height: 1 },
					error: null,
				})) as unknown as typeof fetch,
			timeoutSignal: (ms) => {
				seenTimeouts.push(ms);
				return new AbortController().signal;
			},
		});

		await client.waitfornewblock(20_000);

		expect(seenTimeouts).toEqual([30_000]);
	});

	test("a caller AbortSignal cancels an in-flight waitfornewblock immediately, without retrying", async () => {
		// Never resolves on its own — only an abort settles it, exactly like a
		// real fetch racing a cancelled-mid-flight RPC.
		let fetchCalls = 0;
		const fakeFetch = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				fetchCalls += 1;
				const signal = init?.signal as AbortSignal;
				signal.addEventListener("abort", () => reject(signal.reason));
			})) as unknown as typeof fetch;
		const { sleep, calls } = recordingSleep();
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: fakeFetch,
			sleep,
		});
		const controller = new AbortController();

		const pending = client.waitfornewblock(30_000, controller.signal);
		controller.abort();

		await expect(pending).rejects.toThrow();
		expect(fetchCalls).toBe(1); // not retried
		expect(calls.length).toBe(0); // no backoff sleep either
	});

	test("a plain call uses the default (non-waitfornewblock) timeout", async () => {
		const seenTimeouts: number[] = [];
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			timeoutMs: 12_345,
			fetch: (async () =>
				jsonResponse({ result: 42, error: null })) as unknown as typeof fetch,
			timeoutSignal: (ms) => {
				seenTimeouts.push(ms);
				return new AbortController().signal;
			},
		});

		await client.getblockcount();

		expect(seenTimeouts).toEqual([12_345]);
	});
});

describe("bitcoinRpcClient retry", () => {
	test("2 network errors then success: succeeds and logs exactly 2 retries", async () => {
		let call = 0;
		const fakeFetch = (async () => {
			call += 1;
			if (call <= 2) throw new Error("network unreachable");
			return jsonResponse({ result: 7, error: null });
		}) as unknown as typeof fetch;
		const { sleep } = recordingSleep();
		const logs: unknown[][] = [];
		const originalError = console.error;
		console.error = (...args: unknown[]) => logs.push(args);
		try {
			const client = bitcoinRpcClient({
				url: "http://fake",
				username: "u",
				password: "p",
				fetch: fakeFetch,
				sleep,
			});

			const result = await client.getblockcount();

			expect(result).toBe(7);
			expect(call).toBe(3);
			expect(logs.length).toBe(2);
			expect(String(logs[0]?.[0])).toContain("retry 1/5");
			expect(String(logs[1]?.[0])).toContain("retry 2/5");
		} finally {
			console.error = originalError;
		}
	});

	test("retries an HTTP 5xx with no JSON-RPC error body", async () => {
		let call = 0;
		const fakeFetch = (async () => {
			call += 1;
			if (call === 1) return new Response("upstream failure", { status: 502 });
			return jsonResponse({ result: 1, error: null });
		}) as unknown as typeof fetch;
		const { sleep, calls } = recordingSleep();
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: fakeFetch,
			sleep,
		});

		const result = await client.getblockcount();

		expect(result).toBe(1);
		expect(call).toBe(2);
		expect(calls.length).toBe(1);
	});

	test("a JSON-RPC error is never retried", async () => {
		let call = 0;
		const fakeFetch = (async () => {
			call += 1;
			return jsonResponse(
				{ result: null, error: { code: -5, message: "no such transaction" } },
				500,
			);
		}) as unknown as typeof fetch;
		const { sleep, calls } = recordingSleep();
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: fakeFetch,
			sleep,
		});

		await expect(client.getrawtransaction("deadbeef", true)).rejects.toThrow(
			BitcoinRpcError,
		);

		expect(call).toBe(1);
		expect(calls.length).toBe(0);
	});

	test("a plain 4xx HTTP failure (no JSON-RPC body) is not retried", async () => {
		let call = 0;
		const fakeFetch = (async () => {
			call += 1;
			return new Response("unauthorized", { status: 401 });
		}) as unknown as typeof fetch;
		const { sleep, calls } = recordingSleep();
		const client = bitcoinRpcClient({
			url: "http://fake",
			username: "u",
			password: "p",
			fetch: fakeFetch,
			sleep,
		});

		await expect(client.getblockcount()).rejects.toThrow(/HTTP 401/);

		expect(call).toBe(1);
		expect(calls.length).toBe(0);
	});
});
