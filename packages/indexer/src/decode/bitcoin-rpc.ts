import {
	type BitcoinRpcConfig,
	BitcoinRpcError,
	RPC_NO_SUCH_TX,
	bitcoinRpcCall,
} from "@secondlayer/stacks/bitcoin";

export type { BitcoinRpcConfig };

/**
 * Minimal Bitcoin Core JSON-RPC reader for the settlement confirmer.
 *
 * Why local and not `@secondlayer/stacks`'s `bitcoinRpcSource`: that source is
 * shaped for SPV proof construction and its `getBlockForTx` THROWS when a tx is
 * not yet in a block (`packages/stacks/src/bitcoin/proof.ts`). For this worker,
 * "not yet confirmed" is the normal steady state, so we need a reader that
 * returns 0 confirmations gracefully instead of throwing. The request/auth shape
 * is the shared `bitcoinRpcCall` transport from `@secondlayer/stacks/bitcoin`.
 * If an external SDK consumer ever needs raw confirmation reads, promote this
 * into the published `./bitcoin` module instead.
 *
 * The node must run with `-txindex` so `getrawtransaction` can resolve a historical
 * sweep txid (verified on prod: `docker/node-server/bitcoin.conf`).
 */

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

/** The parts of a verbose `getrawtransaction` the sBTC workers read. */
export interface RawTransaction {
	txid: string;
	vin: { txid?: string; vout?: number; txinwitness?: string[] }[];
	/** `value` is in BTC, as Bitcoin Core returns it. */
	vout: { value: number; n: number }[];
}

/**
 * Build a reader bound to a bitcoind RPC endpoint. The returned `getConfirmations`
 * never throws on a per-tx "unknown/unconfirmed" state — those are normal — but
 * does throw on transport failures (HTTP non-2xx) and unexpected RPC errors,
 * which signal a node outage the confirmer loop should back off on.
 */
export function bitcoinConfirmationReader(config: BitcoinRpcConfig): {
	getConfirmations(txid: string): Promise<TxConfirmation>;
	getRawTransaction(txid: string): Promise<RawTransaction | null>;
} {
	// Core delivers JSON-RPC errors (e.g. -5 "no such transaction") with HTTP
	// 500 and the error in the body; the transport reads the body before the
	// status so the graceful -5 path in getConfirmations stays reachable. The
	// 60s timeout makes a hung bitcoind throw so the loop backs off.
	const call = bitcoinRpcCall(
		{ timeoutMs: 60_000, ...config },
		{ id: "secondlayer-settlement" },
	);
	const rpc = <T>(method: string, params: unknown[]): Promise<T> =>
		call<T>(method, params);

	return {
		/** Verbose tx, or null when the node has no such txid. */
		async getRawTransaction(txid: string): Promise<RawTransaction | null> {
			const rpcTxid = txid.startsWith("0x") ? txid.slice(2) : txid;
			try {
				return await rpc<RawTransaction>("getrawtransaction", [rpcTxid, true]);
			} catch (error) {
				if (error instanceof BitcoinRpcError && error.code === RPC_NO_SUCH_TX) {
					return null;
				}
				throw error;
			}
		},
		async getConfirmations(txid: string): Promise<TxConfirmation> {
			// Sweep txids come from Stacks `0x`-prefixed (66 chars), but Bitcoin
			// Core's getrawtransaction wants a bare 64-hex txid and rejects the
			// prefix ("parameter 1 must be of length 64"). Strip it for the RPC;
			// the returned `txid` keeps the caller's original form.
			const rpcTxid = txid.startsWith("0x") ? txid.slice(2) : txid;
			let tx: { confirmations?: number; blockhash?: string };
			try {
				tx = await rpc("getrawtransaction", [rpcTxid, true]);
			} catch (error) {
				// Unknown txid is a normal state (never broadcast / pruned mempool),
				// not a node failure — report it as not-found rather than throwing.
				if (error instanceof BitcoinRpcError && error.code === RPC_NO_SUCH_TX) {
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
