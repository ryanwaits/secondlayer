/**
 * Bitcoin Core JSON-RPC client for the Runes decoder spike. The request, auth
 * and parse-before-`res.ok` handling live in the shared `bitcoinRpcCall`
 * transport (`@secondlayer/stacks/bitcoin`); this file adds the retry policy
 * and maps the transport's errors onto this package's own error classes.
 */
import {
	BitcoinRpcTransportError,
	BitcoinRpcError as TransportRpcError,
	bitcoinRpcCall,
	bitcoinRpcConfigFromEnv,
} from "@secondlayer/stacks/bitcoin";

export interface BitcoinRpcConfig {
	url: string;
	username: string;
	password: string;
	fetch?: typeof fetch;
	/** Per-call HTTP timeout (ms). Defaults to 60,000. */
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

/** A fetch-layer failure (network error or timeout) — always retryable. The message names the failure kind only, never the fetch error text. */
class RpcNetworkError extends Error {
	constructor(method: string, failure: "network" | "timeout") {
		super(`bitcoin rpc ${method} ${failure} error`);
		this.name = "RpcNetworkError";
	}
}

/** The caller's own `AbortSignal` fired (e.g. `RpcWaitNotifier.close()` cancelling an in-flight `waitfornewblock`) — a deliberate cancel, never retried, unlike a timeout (`RpcNetworkError`). */
class RpcAbortedError extends Error {
	constructor(method: string) {
		super(`bitcoin rpc ${method} aborted by caller`);
		this.name = "RpcAbortedError";
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
	/** Header time, unix seconds. */
	time: number;
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
	 *
	 * An optional `signal` cancels an in-flight call immediately — a
	 * deliberate cancel (e.g. `RpcWaitNotifier.close()`), not a timeout, so it
	 * rejects without going through the retry loop (plan 084).
	 */
	waitfornewblock(
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<{ hash: string; height: number }>;
	/** Used by `RpcWaitNotifier`'s fallback path when `waitfornewblock` answers `-32601` (method not found). */
	getbestblockhash(): Promise<string>;
}

/** Build a JSON-RPC client bound to a bitcoind endpoint. */
export function bitcoinRpcClient(config: BitcoinRpcConfig): BitcoinRpcClient {
	const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const sleepFn = config.sleep ?? sleep;
	const call = bitcoinRpcCall(
		{
			url: config.url,
			auth: { username: config.username, password: config.password },
			fetch: config.fetch,
		},
		{ id: "secondlayer-bitcoin", timeoutSignal: config.timeoutSignal },
	);

	async function rpcOnce<T>(
		method: string,
		params: unknown[],
		fetchTimeoutMs: number,
		callerSignal?: AbortSignal,
	): Promise<T> {
		try {
			return await call<T>(method, params, {
				timeoutMs: fetchTimeoutMs,
				signal: callerSignal,
			});
		} catch (error) {
			if (error instanceof TransportRpcError) {
				throw new BitcoinRpcError(
					`bitcoin rpc ${method} error: ${error.rpcMessage}`,
					error.code,
				);
			}
			if (error instanceof BitcoinRpcTransportError) {
				const message = `bitcoin rpc ${method} failed: HTTP ${error.status}`;
				switch (error.failure) {
					// The caller's own signal firing is a deliberate cancel, distinct
					// from the timeout — `rpc()` below never retries it.
					case "aborted":
						throw new RpcAbortedError(method);
					case "network":
					case "timeout":
						throw new RpcNetworkError(method, error.failure);
					case "http":
						if ((error.status ?? 0) >= 500)
							throw new RetryableHttpError(message);
						throw new Error(message);
					case "bad-body":
						throw new RetryableHttpError(message);
				}
			}
			throw error;
		}
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
		callerSignal?: AbortSignal,
	): Promise<T> {
		const timeoutMs = fetchTimeoutMs ?? defaultTimeoutMs;
		for (let attempt = 0; ; attempt++) {
			try {
				return await rpcOnce<T>(method, params, timeoutMs, callerSignal);
			} catch (error) {
				if (error instanceof BitcoinRpcError) throw error;
				// A deliberate caller cancel — not 076's retry loop's business.
				if (error instanceof RpcAbortedError) throw error;
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
		waitfornewblock: (timeoutMs: number, signal?: AbortSignal) =>
			rpc<{ hash: string; height: number }>(
				"waitfornewblock",
				[timeoutMs],
				timeoutMs + 10_000,
				signal,
			),
		getbestblockhash: () => rpc<string>("getbestblockhash", []),
	};
}

export function bitcoinRpcClientFromEnv(): BitcoinRpcClient {
	const config = bitcoinRpcConfigFromEnv(process.env);
	const credentials = config?.auth ? credentialsOf(config.auth) : undefined;
	if (!config || !credentials) {
		throw new Error(
			"BITCOIN_RPC_URL and either BITCOIN_RPC_AUTH or BITCOIN_RPC_USERNAME + BITCOIN_RPC_PASSWORD are required",
		);
	}
	return bitcoinRpcClient({ url: config.url, ...credentials });
}

/** `BITCOIN_RPC_AUTH` is base64 `username:password`; split on the first `:` only. */
function credentialsOf(
	auth: { username: string; password: string } | string,
): { username: string; password: string } | undefined {
	if (typeof auth !== "string") return auth;
	let decoded: string;
	try {
		decoded = atob(auth);
	} catch {
		return undefined;
	}
	const colon = decoded.indexOf(":");
	if (colon < 0) return undefined;
	return {
		username: decoded.slice(0, colon),
		password: decoded.slice(colon + 1),
	};
}
