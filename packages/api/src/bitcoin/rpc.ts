import type { BitcoinRpcConfig } from "@secondlayer/stacks/bitcoin";

/**
 * The instance's own Bitcoin Core node over JSON-RPC, for the routes that
 * read it live (`/v1/proofs/bitcoin-tx`, `/v1/bitcoin/outspend`).
 * `BITCOIN_RPC_URL` unset means the instance has no Bitcoin node: those
 * routes answer 503 rather than failing.
 */

/** `BITCOIN_RPC_URL` plus basic auth when both credentials are set. */
export function bitcoinRpcFromEnv(): BitcoinRpcConfig | undefined {
	const url = process.env.BITCOIN_RPC_URL?.trim();
	if (!url) return undefined;
	const username = process.env.BITCOIN_RPC_USERNAME;
	const password = process.env.BITCOIN_RPC_PASSWORD;
	return username && password ? { url, auth: { username, password } } : { url };
}

/** A JSON-RPC answer with an error object: a real reply from bitcoind. */
export class BitcoindRpcError extends Error {
	constructor(
		readonly method: string,
		readonly code: number,
		message: string,
	) {
		super(`bitcoin rpc ${method} error ${code}: ${message}`);
		this.name = "BitcoindRpcError";
	}
}

/** No usable answer: unreachable, timed out, or a non-JSON-RPC status
 *  (an `rpcwhitelist` refusal is a bare 403). */
export class BitcoindUnreachableError extends Error {
	constructor(readonly method: string) {
		super(`bitcoin rpc ${method}: no usable answer from bitcoind`);
		this.name = "BitcoindUnreachableError";
	}
}

/** Bitcoin Core's code for an unknown txid. */
export const RPC_NO_SUCH_TX = -5;
/** Bitcoin Core's code for a method it does not have. */
export const RPC_METHOD_NOT_FOUND = -32601;

export type BitcoindCall = <T>(method: string, params: unknown[]) => Promise<T>;

/**
 * One bitcoind call per invocation, no retries: a request path answers or
 * fails within `timeoutMs`. Error messages never carry the URL.
 */
export function bitcoindCall(
	config: BitcoinRpcConfig,
	timeoutMs = 30_000,
): BitcoindCall {
	const doFetch = config.fetch ?? fetch;
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (config.auth) {
		headers.authorization = `Basic ${
			typeof config.auth === "string"
				? config.auth
				: btoa(`${config.auth.username}:${config.auth.password}`)
		}`;
	}
	return async <T>(method: string, params: unknown[]): Promise<T> => {
		let res: Response;
		try {
			res = await doFetch(config.url, {
				method: "POST",
				headers,
				body: JSON.stringify({
					jsonrpc: "1.0",
					id: "secondlayer-api",
					method,
					params,
				}),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch {
			throw new BitcoindUnreachableError(method);
		}
		// Bitcoin Core sends JSON-RPC errors with HTTP 500 and the error in the
		// body, so the body is read before the status.
		let body: {
			result?: T;
			error?: { code: number; message: string } | null;
		} | null;
		try {
			body = (await res.json()) as typeof body;
		} catch {
			body = null;
		}
		if (body?.error) {
			throw new BitcoindRpcError(method, body.error.code, body.error.message);
		}
		if (!res.ok || !body || !("result" in body)) {
			throw new BitcoindUnreachableError(method);
		}
		return body.result as T;
	};
}
