/**
 * x402 payment-rail shared constants: the v1 token set + CAIP-2 network ids.
 *
 * Single-sourced here (not in the API package) so the SDK/MCP client and the
 * API facilitator agree on asset ids, decimals, and the `accepts[]` asset-string
 * format. All ids are mainnet and confirmed on-chain (2026-06). Per-call prices
 * are NOT here — they are API-local (see `packages/api/src/x402/catalog.ts`) and
 * exposed to clients at runtime via `GET /x402/supported`.
 */

/** CAIP-2 network ids used in x402 v2 `accepts[]` entries. */
export const X402_NETWORK = {
	mainnet: "stacks:1",
	testnet: "stacks:2147483648",
} as const;

export type X402Network = (typeof X402_NETWORK)[keyof typeof X402_NETWORK];

export type X402TokenSymbol = "STX" | "sBTC" | "USDCx";

export type X402Token = {
	symbol: X402TokenSymbol;
	/** x402 `asset` string: `"STX"` for native, else the `<addr>.<contract>` id. */
	asset: string;
	/** SIP-010 contract id (`<addr>.<contract>`); `null` for native STX. */
	contractId: string | null;
	/** SIP-010 fungible-token asset name (the `::<name>` suffix); `null` for STX. */
	assetName: string | null;
	/** Fully-qualified SIP-010 asset identifier (`<id>::<name>`); `null` for STX. */
	assetIdentifier: string | null;
	decimals: number;
};

/** v1 token set. sBTC + USDCx ids verified against the deployed mainnet contracts. */
export const X402_TOKENS: Record<X402TokenSymbol, X402Token> = {
	STX: {
		symbol: "STX",
		asset: "STX",
		contractId: null,
		assetName: null,
		assetIdentifier: null,
		decimals: 6,
	},
	sBTC: {
		symbol: "sBTC",
		asset: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
		contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
		assetName: "sbtc-token",
		assetIdentifier:
			"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
		decimals: 8,
	},
	USDCx: {
		symbol: "USDCx",
		asset: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
		contractId: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx",
		assetName: "usdcx-token",
		assetIdentifier:
			"SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx::usdcx-token",
		decimals: 6,
	},
} as const;

export const X402_TOKEN_SYMBOLS = Object.keys(X402_TOKENS) as X402TokenSymbol[];

export function getX402Token(symbol: X402TokenSymbol): X402Token {
	return X402_TOKENS[symbol];
}

/**
 * Optimistic-serve reputation: the Redis key + TTL for a payer principal's
 * "strike" counter (reverted/dropped payments). Single-sourced so the API gate
 * (reader) and the worker reconciler (writer, on revert) agree without a
 * cross-package import.
 */
export const X402_STRIKE_TTL_SECONDS: number = 24 * 60 * 60;

export function x402StrikeKey(principal: string): string {
	return `x402:strikes:${principal}`;
}

/**
 * Normalize an x402 payment txid to the form stored in `decoded_events`.
 * Broadcast/ledger txids are bare lowercase hex; the index stores them
 * `0x`-prefixed. Querying `decoded_events` with the bare form silently never
 * matches — which wedged the rail's confirmation layer (optimistic payments
 * reverted + struck the payer; confirmed-tier never confirmed). Idempotent and
 * case-normalizing, so it's safe to apply at every index query site.
 */
export function toIndexTxId(txid: string): string {
	const hex = txid.startsWith("0x") ? txid.slice(2) : txid;
	return `0x${hex.toLowerCase()}`;
}

/** Resolve a token by its x402 `asset` string (the value carried in `accepts[].asset`). */
export function findX402TokenByAsset(asset: string): X402Token | undefined {
	for (const symbol of X402_TOKEN_SYMBOLS) {
		if (X402_TOKENS[symbol].asset === asset) return X402_TOKENS[symbol];
	}
	return undefined;
}
