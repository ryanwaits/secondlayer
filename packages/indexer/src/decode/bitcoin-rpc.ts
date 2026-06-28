/**
 * Minimal Bitcoin Core JSON-RPC reader for the settlement confirmer.
 *
 * Why local and not `@secondlayer/stacks`'s `bitcoinRpcSource`: that source is
 * shaped for SPV proof construction and its `getBlockForTx` THROWS when a tx is
 * not yet in a block (`packages/stacks/src/bitcoin/proof.ts`). For this worker,
 * "not yet confirmed" is the normal steady state, so we need a reader that
 * returns 0 confirmations gracefully instead of throwing. The request/auth shape
 * mirrors that module conceptually. If an external SDK consumer ever needs raw
 * confirmation reads, promote this into the published `./bitcoin` module instead.
 *
 * The node must run with `-txindex` so `getrawtransaction` can resolve a historical
 * sweep txid (verified on prod: `docker/node-server/bitcoin.conf`).
 */

export interface BitcoinRpcConfig {
	/** Bitcoin Core JSON-RPC endpoint URL. */
	url: string;
	/** Basic auth — `{ username, password }` or a pre-encoded base64 string. */
	auth?: { username: string; password: string } | string;
	/** Override the fetch implementation (testing / custom agents). */
	fetch?: typeof fetch;
}

export interface TxConfirmation {
	txid: string;
	/** false when the node has no record of the txid (Core error -5). */
	found: boolean;
	/** 0 when in the mempool / unconfirmed / not found. */
	confirmations: number;
	/** Confirming block hash, or null while unconfirmed. */
	blockHash: string | null;
	/** Confirming block height, or null while unconfirmed. */
	blockHeight: number | null;
}

/** Bitcoin Core returns this code for an unknown txid (no such mempool/chain tx). */
const RPC_ERROR_NO_SUCH_TX = -5;

class BitcoinRpcError extends Error {
	constructor(
		message: string,
		readonly code: number,
	) {
		super(message);
		this.name = "BitcoinRpcError";
	}
}

/**
 * Build a reader bound to a bitcoind RPC endpoint. The returned `getConfirmations`
 * never throws on a per-tx "unknown/unconfirmed" state — those are normal — but
 * does throw on transport failures (HTTP non-2xx) and unexpected RPC errors,
 * which signal a node outage the confirmer loop should back off on.
 */
export function bitcoinConfirmationReader(config: BitcoinRpcConfig): {
	getConfirmations(txid: string): Promise<TxConfirmation>;
} {
	const doFetch = config.fetch ?? fetch;

	async function rpc<T>(method: string, params: unknown[]): Promise<T> {
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
		const res = await doFetch(config.url, {
			method: "POST",
			headers,
			body: JSON.stringify({
				jsonrpc: "1.0",
				id: "secondlayer-settlement",
				method,
				params,
			}),
		});
		if (!res.ok) {
			throw new Error(`bitcoin rpc ${method} failed: HTTP ${res.status}`);
		}
		const json = (await res.json()) as {
			result: T;
			error: { code: number; message: string } | null;
		};
		if (json.error) {
			throw new BitcoinRpcError(
				`bitcoin rpc ${method} error: ${json.error.message}`,
				json.error.code,
			);
		}
		return json.result;
	}

	return {
		async getConfirmations(txid: string): Promise<TxConfirmation> {
			let tx: { confirmations?: number; blockhash?: string };
			try {
				tx = await rpc("getrawtransaction", [txid, true]);
			} catch (error) {
				// Unknown txid is a normal state (never broadcast / pruned mempool),
				// not a node failure — report it as not-found rather than throwing.
				if (
					error instanceof BitcoinRpcError &&
					error.code === RPC_ERROR_NO_SUCH_TX
				) {
					return {
						txid,
						found: false,
						confirmations: 0,
						blockHash: null,
						blockHeight: null,
					};
				}
				throw error;
			}

			// In the mempool / unconfirmed: verbose getrawtransaction omits both
			// `blockhash` and `confirmations`.
			if (!tx.blockhash) {
				return {
					txid,
					found: true,
					confirmations: tx.confirmations ?? 0,
					blockHash: null,
					blockHeight: null,
				};
			}

			// Verbose getrawtransaction gives `confirmations` but not the block
			// height — fetch it from the block header (verbosity 1, no tx data).
			const block = await rpc<{ height: number }>("getblock", [
				tx.blockhash,
				1,
			]);
			return {
				txid,
				found: true,
				confirmations: tx.confirmations ?? 1,
				blockHash: tx.blockhash,
				blockHeight: block.height,
			};
		},
	};
}
