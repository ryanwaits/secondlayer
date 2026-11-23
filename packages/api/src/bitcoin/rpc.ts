import {
	type BitcoinRpcConfig,
	BitcoinRpcError,
	BitcoinRpcTransportError,
	RPC_METHOD_NOT_FOUND,
	RPC_NO_SUCH_TX,
	bitcoinRpcCall,
	bitcoinRpcConfigFromEnv,
} from "@secondlayer/stacks/bitcoin";

export { RPC_METHOD_NOT_FOUND, RPC_NO_SUCH_TX };

export function bitcoinRpcFromEnv(): BitcoinRpcConfig | undefined {
	return bitcoinRpcConfigFromEnv(process.env);
}

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

export type BitcoindCall = <T>(method: string, params: unknown[]) => Promise<T>;

/**
 * One bitcoind call per invocation, no retries: a request path answers or
 * fails within `timeoutMs`. Error messages never carry the URL.
 */
export function bitcoindCall(
	config: BitcoinRpcConfig,
	timeoutMs = 30_000,
): BitcoindCall {
	const call = bitcoinRpcCall(config, { id: "secondlayer-api" });
	return async <T>(method: string, params: unknown[]): Promise<T> => {
		try {
			return await call<T>(method, params, { timeoutMs });
		} catch (error) {
			if (error instanceof BitcoinRpcError) {
				throw new BitcoindRpcError(method, error.code, error.rpcMessage);
			}
			if (error instanceof BitcoinRpcTransportError) {
				throw new BitcoindUnreachableError(method);
			}
			throw error;
		}
	};
}
