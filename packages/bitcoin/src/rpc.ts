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
}

/** Build a JSON-RPC client bound to a bitcoind endpoint. */
export function bitcoinRpcClient(config: BitcoinRpcConfig): BitcoinRpcClient {
	const doFetch = config.fetch ?? fetch;
	const basicAuth = btoa(`${config.username}:${config.password}`);

	async function rpc<T>(method: string, params: unknown[]): Promise<T> {
		const res = await doFetch(config.url, {
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
		});
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
			throw new Error(`bitcoin rpc ${method} failed: HTTP ${res.status}`);
		}
		return (json as { result: T }).result;
	}

	return {
		getblockcount: () => rpc<number>("getblockcount", []),
		getblockhash: (height: number) => rpc<string>("getblockhash", [height]),
		getblock: (hash: string) => rpc<string>("getblock", [hash, 0]),
		getblockheader: (hash: string) =>
			rpc<BlockHeader>("getblockheader", [hash, true]),
		getrawtransaction: (txid: string, verbose: true) =>
			rpc<RawTransactionVerbose>("getrawtransaction", [txid, verbose]),
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
