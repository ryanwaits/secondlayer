/**
 * Bitcoin Core JSON-RPC client for the Runes decoder spike.
 *
 * Parse-before-`res.ok` pattern copied from
 * `packages/indexer/src/decode/bitcoin-rpc.ts:81-106`: Bitcoin Core returns
 * JSON-RPC errors (e.g. -5 "no such transaction") with an HTTP 500 status AND
 * the error in the body, so the body must be parsed before checking `res.ok`
 * or every RPC-level error is masked as a generic HTTP failure.
 */

export interface BitcoinRpcConfig {
	url: string;
	username: string;
	password: string;
	fetch?: typeof fetch;
	/** Per-call HTTP timeout (ms). Defaults to `BITCOIN_RPC_TIMEOUT_MS` env, or 60,000. */
	timeoutMs?: number;
	/** Test seam: overrides the real `setTimeout`-based sleep used for retry backoff. */
	sleep?: (ms: number) => Promise<void>;
	/** Test seam: overrides `AbortSignal.timeout` so a test can observe the ms a call requests without waiting on a real timer. */
	timeoutSignal?: (ms: number) => AbortSignal;
}

export class BitcoinRpcError extends Error {
	constructor(
		message: string,
		readonly code: number,
	) {
		super(message);
		this.name = "BitcoinRpcError";
	}
}

/** A fetch-layer failure (network error, abort, timeout) — always retryable. Wraps whatever `fetch` itself threw. */
class RpcNetworkError extends Error {
	constructor(method: string, cause: unknown) {
		super(
			`bitcoin rpc ${method} network error: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
		this.name = "RpcNetworkError";
	}
}

/** An HTTP 5xx with no JSON-RPC error body — bitcoind/the proxy in front of it failed, not a real RPC answer. Retryable, unlike a 4xx (which means our own request is wrong and won't succeed on retry). */
class RetryableHttpError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RetryableHttpError";
	}
}

function isRetryable(error: unknown): boolean {
	return (
		error instanceof RpcNetworkError || error instanceof RetryableHttpError
	);
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jittered exponential backoff, 1s -> 30s cap (equal jitter: never less than half the computed cap). */
function jitteredBackoff(attempt: number): number {
	const cap = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
	return cap / 2 + Math.random() * (cap / 2);
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface RawTransactionVerbose {
	txid: string;
	hash: string;
	blockhash?: string;
	confirmations?: number;
	vin: Array<{
		txid?: string;
		vout?: number;
		coinbase?: string;
		txinwitness?: string[];
	}>;
	vout: Array<{
		value: number;
		n: number;
		scriptPubKey: { hex: string };
	}>;
}

export interface BlockHeader {
	hash: string;
	height: number;
	previousblockhash?: string;
}

export interface BitcoinRpcClient {
	getblockcount(): Promise<number>;
	getblockhash(height: number): Promise<string>;
	/** Raw block hex (verbosity 0), per D6. */
	getblock(hash: string): Promise<string>;
	getblockheader(hash: string): Promise<BlockHeader>;
	getrawtransaction(
		txid: string,
		verbose: true,
	): Promise<RawTransactionVerbose>;
	/** Raw tx hex (verbosity 0) — used by `cli.ts repair-entries` (plan 040), which parses it itself instead of trusting bitcoind's decode. */
	getrawtransaction(txid: string, verbose: false): Promise<string>;
	/**
	 * Blocks until a new block arrives or `timeoutMs` elapses (whichever
	 * first), then returns the current best block — a hidden RPC (D12,
	 * amended 2026-09-26; `bitcoin-cli help waitfornewblock` works, but it
	 * isn't listed in `help`). `RpcWaitNotifier` treats either outcome the
	 * same: a signal to re-run sync. `bitcoinRpcClient`'s HTTP fetch timeout
	 * for this call is `timeoutMs + 10_000` (plan 076), so the HTTP layer
	 * never times out before bitcoind's own blocking wait does.
	 */
	waitfornewblock(timeoutMs: number): Promise<{ hash: string; height: number }>;
	/** Used by `RpcWaitNotifier`'s fallback path when `waitfornewblock` answers `-32601` (method not found). */
	getbestblockhash(): Promise<string>;
}

/** Build a JSON-RPC client bound to a bitcoind endpoint. */
export function bitcoinRpcClient(config: BitcoinRpcConfig): BitcoinRpcClient {
	const doFetch = config.fetch ?? fetch;
	const basicAuth = btoa(`${config.username}:${config.password}`);
	const defaultTimeoutMs =
		config.timeoutMs ??
		Number(process.env.BITCOIN_RPC_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
	const sleepFn = config.sleep ?? sleep;
	const timeoutSignalFn =
		config.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));

	async function rpcOnce<T>(
		method: string,
		params: unknown[],
		fetchTimeoutMs: number,
	): Promise<T> {
		let res: Response;
		try {
			res = await doFetch(config.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Basic ${basicAuth}`,
				},
				body: JSON.stringify({
					jsonrpc: "1.0",
					id: "secondlayer-bitcoin",
					method,
					params,
				}),
				signal: timeoutSignalFn(fetchTimeoutMs),
			});
		} catch (error) {
			throw new RpcNetworkError(method, error);
		}
		// Bitcoin Core delivers JSON-RPC errors with an HTTP 500 status AND the
		// error in the body — parse the body BEFORE throwing on `!res.ok`, or the
		// specific RPC error code/message is unreachable.
		let json: {
			result: T;
			error: { code: number; message: string } | null;
		} | null;
		try {
			json = (await res.json()) as typeof json;
		} catch {
			json = null;
		}
		if (json?.error) {
			throw new BitcoinRpcError(
				`bitcoin rpc ${method} error: ${json.error.message}`,
				json.error.code,
			);
		}
		if (!res.ok) {
			const message = `bitcoin rpc ${method} failed: HTTP ${res.status}`;
			if (res.status >= 500) throw new RetryableHttpError(message);
			throw new Error(message);
		}
		return (json as { result: T }).result;
	}

	/**
	 * Retries transient failures (network error, abort/timeout, HTTP 5xx
	 * without a JSON-RPC error body) up to `MAX_RETRIES` times with jittered
	 * exponential backoff. Never retries a `BitcoinRpcError` — a real JSON-RPC
	 * answer, which `RpcWaitNotifier` relies on seeing immediately (e.g.
	 * `-32601`).
	 */
	async function rpc<T>(
		method: string,
		params: unknown[],
		fetchTimeoutMs?: number,
	): Promise<T> {
		const timeoutMs = fetchTimeoutMs ?? defaultTimeoutMs;
		for (let attempt = 0; ; attempt++) {
			try {
				return await rpcOnce<T>(method, params, timeoutMs);
			} catch (error) {
				if (error instanceof BitcoinRpcError) throw error;
				if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
				const wait = jitteredBackoff(attempt + 1);
				console.error(
					`bitcoin rpc ${method}: retry ${attempt + 1}/${MAX_RETRIES} after ${describeError(error)} (waiting ${Math.round(wait)}ms)`,
				);
				await sleepFn(wait);
			}
		}
	}

	return {
		getblockcount: () => rpc<number>("getblockcount", []),
		getblockhash: (height: number) => rpc<string>("getblockhash", [height]),
		getblock: (hash: string) => rpc<string>("getblock", [hash, 0]),
		getblockheader: (hash: string) =>
			rpc<BlockHeader>("getblockheader", [hash, true]),
		getrawtransaction: ((txid: string, verbose: boolean) =>
			rpc<RawTransactionVerbose | string>("getrawtransaction", [
				txid,
				verbose,
			])) as BitcoinRpcClient["getrawtransaction"],
		// waitfornewblock blocks inside bitcoind for up to `timeoutMs` — the HTTP
		// layer's own timeout must be strictly longer, or the fetch aborts before
		// bitcoind ever answers (rpc.ts docstring on `waitfornewblock` above).
		waitfornewblock: (timeoutMs: number) =>
			rpc<{ hash: string; height: number }>(
				"waitfornewblock",
				[timeoutMs],
				timeoutMs + 10_000,
			),
		getbestblockhash: () => rpc<string>("getbestblockhash", []),
	};
}

export function bitcoinRpcClientFromEnv(): BitcoinRpcClient {
	const url = process.env.BITCOIN_RPC_URL;
	const username = process.env.BITCOIN_RPC_USERNAME;
	const password = process.env.BITCOIN_RPC_PASSWORD;
	if (!url || !username || !password) {
		throw new Error(
			"BITCOIN_RPC_URL, BITCOIN_RPC_USERNAME, BITCOIN_RPC_PASSWORD are required",
		);
	}
	return bitcoinRpcClient({ url, username, password });
}
