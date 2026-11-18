/** Bitcoin Core JSON-RPC endpoint and credentials. */
export interface BitcoinRpcConfig {
	/** Bitcoin Core JSON-RPC endpoint URL. */
	url: string;
	/** Basic auth — `{ username, password }` or a pre-encoded base64 string. */
	auth?: { username: string; password: string } | string;
	/** Override the fetch implementation (testing / custom agents). */
	fetch?: typeof fetch;
	/** Default per-call HTTP timeout (ms). Unset: no timeout. */
	timeoutMs?: number;
}

/** A real JSON-RPC answer carrying an error object (e.g. -5 unknown txid). */
export class BitcoinRpcError extends Error {
	override readonly name = "BitcoinRpcError";
	constructor(
		readonly method: string,
		readonly code: number,
		/** The node's own error text, without the method/code framing. */
		readonly rpcMessage: string,
	) {
		super(`bitcoin rpc ${method} error ${code}: ${rpcMessage}`);
	}
}

export type BitcoinRpcTransportFailure =
	| "network"
	| "timeout"
	| "aborted"
	| "http"
	| "bad-body";

/**
 * No usable JSON-RPC answer. The message never carries the URL, credentials or
 * the underlying fetch error text.
 */
export class BitcoinRpcTransportError extends Error {
	override readonly name = "BitcoinRpcTransportError";
	constructor(
		readonly method: string,
		readonly failure: BitcoinRpcTransportFailure,
		readonly status?: number,
	) {
		super(
			`bitcoin rpc ${method}: ${failure}${status !== undefined ? ` (HTTP ${status})` : ""}`,
		);
	}
}

export const RPC_NO_SUCH_TX = -5;
export const RPC_METHOD_NOT_FOUND = -32601;

export interface BitcoinRpcCallOptions {
	/** Caller cancel; a fired caller signal is failure "aborted", never "timeout". */
	signal?: AbortSignal;
	/** Overrides config.timeoutMs for this call. */
	timeoutMs?: number;
}

export type BitcoinRpcCall = <T>(
	method: string,
	params: unknown[],
	options?: BitcoinRpcCallOptions,
) => Promise<T>;

/**
 * One Bitcoin Core JSON-RPC call per invocation, no retries. Core answers RPC
 * errors with HTTP 500, so the body is parsed before the status is checked.
 */
export function bitcoinRpcCall(
	config: BitcoinRpcConfig,
	options: {
		/** JSON-RPC request id, for telling callers apart in bitcoind logs. */
		id?: string;
		/** Test seam: replaces AbortSignal.timeout. */
		timeoutSignal?: (ms: number) => AbortSignal;
	} = {},
): BitcoinRpcCall {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (config.auth) {
		const basic =
			typeof config.auth === "string"
				? config.auth
				: btoa(`${config.auth.username}:${config.auth.password}`);
		headers.authorization = `Basic ${basic}`;
	}
	const id = options.id ?? "secondlayer";
	const makeTimeout = options.timeoutSignal ?? AbortSignal.timeout;

	return async <T>(
		method: string,
		params: unknown[],
		callOptions: BitcoinRpcCallOptions = {},
	): Promise<T> => {
		const ms = callOptions.timeoutMs ?? config.timeoutMs;
		const timeout = ms === undefined ? undefined : makeTimeout(ms);
		const signals = [timeout, callOptions.signal].filter(
			(s): s is AbortSignal => s !== undefined,
		);
		const signal =
			signals.length === 0
				? undefined
				: signals.length === 1
					? signals[0]
					: AbortSignal.any(signals);

		const doFetch = config.fetch ?? fetch;
		let res: Response;
		try {
			res = await doFetch(config.url, {
				method: "POST",
				headers,
				body: JSON.stringify({ jsonrpc: "1.0", id, method, params }),
				signal,
			});
		} catch {
			if (callOptions.signal?.aborted) {
				throw new BitcoinRpcTransportError(method, "aborted");
			}
			if (timeout?.aborted) {
				throw new BitcoinRpcTransportError(method, "timeout");
			}
			throw new BitcoinRpcTransportError(method, "network");
		}

		let json: {
			result?: unknown;
			error?: { code?: number; message?: string } | null;
		} | null;
		try {
			json = (await res.json()) as typeof json;
		} catch {
			json = null;
		}
		if (json?.error) {
			throw new BitcoinRpcError(
				method,
				json.error.code ?? 0,
				json.error.message ?? "",
			);
		}
		if (!res.ok) {
			throw new BitcoinRpcTransportError(method, "http", res.status);
		}
		if (json === null || typeof json !== "object" || !("result" in json)) {
			throw new BitcoinRpcTransportError(method, "bad-body", res.status);
		}
		return json.result as T;
	};
}

/**
 * BITCOIN_RPC_URL (trimmed; unset/blank → undefined), auth from
 * BITCOIN_RPC_AUTH, else BITCOIN_RPC_USERNAME + BITCOIN_RPC_PASSWORD when both
 * are set. Takes the env as an argument so this module never reads `process`.
 */
export function bitcoinRpcConfigFromEnv(
	env: Record<string, string | undefined>,
): BitcoinRpcConfig | undefined {
	const url = env.BITCOIN_RPC_URL?.trim();
	if (!url) return undefined;
	const username = env.BITCOIN_RPC_USERNAME;
	const password = env.BITCOIN_RPC_PASSWORD;
	const auth =
		env.BITCOIN_RPC_AUTH ||
		(username && password ? { username, password } : undefined);
	return auth ? { url, auth } : { url };
}
