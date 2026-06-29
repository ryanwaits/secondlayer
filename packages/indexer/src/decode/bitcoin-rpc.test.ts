import { describe, expect, test } from "bun:test";
import { bitcoinConfirmationReader } from "./bitcoin-rpc.ts";

type RpcResult = {
	ok?: boolean;
	status?: number;
	result?: unknown;
	error?: { code: number; message: string } | null;
};

function mockFetch(
	handler: (method: string, params: unknown[]) => RpcResult,
): typeof fetch {
	return (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string) as {
			method: string;
			params: unknown[];
		};
		const r = handler(body.method, body.params);
		if (r.ok === false) {
			// Real bitcoind returns JSON-RPC errors (e.g. -5) with an HTTP 500
			// status AND the error in the body — model that, not an empty body.
			return {
				ok: false,
				status: r.status ?? 500,
				json: async () => ({
					result: r.result ?? null,
					error: r.error ?? null,
				}),
			} as unknown as Response;
		}
		return {
			ok: true,
			status: 200,
			json: async () => ({ result: r.result ?? null, error: r.error ?? null }),
		} as unknown as Response;
	}) as unknown as typeof fetch;
}

describe("bitcoinConfirmationReader.getConfirmations", () => {
	test("confirmed tx: parses confirmations + resolves block height", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch((method) => {
				if (method === "getrawtransaction")
					return { result: { confirmations: 6, blockhash: "0xabc" } };
				if (method === "getblock") return { result: { height: 800123 } };
				throw new Error(`unexpected method ${method}`);
			}),
		});

		expect(await reader.getConfirmations("0xsweep")).toEqual({
			txid: "0xsweep",
			found: true,
			confirmations: 6,
			blockHash: "0xabc",
			blockHeight: 800123,
		});
	});

	test("mempool / unconfirmed: no blockhash → 0 confirmations, no block", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch((method) => {
				if (method === "getrawtransaction") return { result: {} };
				throw new Error("getblock should not be called for a mempool tx");
			}),
		});

		expect(await reader.getConfirmations("0xsweep")).toEqual({
			txid: "0xsweep",
			found: true,
			confirmations: 0,
			blockHash: null,
			blockHeight: null,
		});
	});

	test("unknown txid (RPC error -5): not-found, does not throw", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch(() => ({
				error: {
					code: -5,
					message: "No such mempool or blockchain transaction",
				},
			})),
		});

		expect(await reader.getConfirmations("0xnope")).toEqual({
			txid: "0xnope",
			found: false,
			confirmations: 0,
			blockHash: null,
			blockHeight: null,
		});
	});

	test("unknown txid as HTTP 500 + body error -5 (real bitcoind): not-found, does not throw", async () => {
		// Bitcoin Core returns RPC error -5 with an HTTP 500 status code AND the
		// error in the JSON body. The reader must parse the body before reacting
		// to the non-2xx status, or the confirmer crashes on every sweep that
		// isn't yet on this node (still in mempool / not broadcast / pruned).
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch(() => ({
				ok: false,
				status: 500,
				error: {
					code: -5,
					message: "No such mempool or blockchain transaction",
				},
			})),
		});

		expect(await reader.getConfirmations("0xnope")).toEqual({
			txid: "0xnope",
			found: false,
			confirmations: 0,
			blockHash: null,
			blockHeight: null,
		});
	});

	test("unexpected RPC error as HTTP 500 + body error -8: throws (not swallowed)", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch(() => ({
				ok: false,
				status: 500,
				error: { code: -8, message: "some other error" },
			})),
		});

		await expect(reader.getConfirmations("0xsweep")).rejects.toThrow(
			/some other error/,
		);
	});

	test("HTTP non-2xx with no JSON-RPC error body (transport outage) throws", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch(() => ({ ok: false, status: 500 })),
		});

		await expect(reader.getConfirmations("0xsweep")).rejects.toThrow(
			/HTTP 500/,
		);
	});

	test("HTTP non-2xx with unparseable (non-JSON) body throws HTTP error", async () => {
		// e.g. a proxy 502 with an HTML body: res.json() rejects → no JSON-RPC
		// error to extract → surface the transport failure.
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: (async () =>
				({
					ok: false,
					status: 502,
					json: async () => {
						throw new SyntaxError("Unexpected token < in JSON");
					},
				}) as unknown as Response) as unknown as typeof fetch,
		});

		await expect(reader.getConfirmations("0xsweep")).rejects.toThrow(
			/HTTP 502/,
		);
	});

	test("unexpected RPC error code throws (not swallowed)", async () => {
		const reader = bitcoinConfirmationReader({
			url: "http://node/",
			fetch: mockFetch(() => ({
				error: { code: -8, message: "some other error" },
			})),
		});

		await expect(reader.getConfirmations("0xsweep")).rejects.toThrow(
			/some other error/,
		);
	});
});
