import {
	type X402TokenSymbol,
	X402_TOKEN_SYMBOLS,
} from "@secondlayer/shared/x402";

/**
 * x402 price catalog — API-local (mirrors `STREAMS_TIER_CONFIG`). Prices are
 * flat-per-call USD; row/event-priced surfaces can't pay-before-response and are
 * excluded by construction. Clients read this at runtime via `GET /x402/supported`
 * (T14), never by importing it — the shared package only carries asset/network
 * constants (`@secondlayer/shared/x402`).
 */

export type X402Surface = "streams" | "index";

export type X402PriceConfig = {
	/** Flat per-call price in USD. The challenge converts this to each asset's
	 *  atomic units using live spot at mint time. */
	priceUsd: number;
	/** Assets offered as `accepts[]` entries for this surface. */
	assets: readonly X402TokenSymbol[];
	/** x402 `maxTimeoutSeconds` — also the confirmed-tier await-canonical deadline. */
	maxTimeoutSeconds: number;
};

/**
 * Hard minimum per-call charge. The sponsor pays the STX gas per call, so a
 * charge below gas loses money. $0.001 covers the busy-market peak (~$0.0009 at
 * STX $0.18) with margin; `resolvePriceFloorUsd` lifts it further when live gas
 * is higher (e.g. STX appreciation + congestion).
 */
export const X402_MIN_FLOOR_USD = 0.001;

/**
 * Representative serialized size (bytes) of a sponsored SIP-010 transfer with a
 * post-condition. Drives the gas-floor estimate; a fatter multi-arg call trends
 * higher, so this is a conservative-typical figure, not a floor.
 */
export const X402_SPONSORED_TX_BYTES = 600;

export const X402_PRICE_CATALOG: Record<X402Surface, X402PriceConfig> = {
	streams: {
		priceUsd: 0.001,
		assets: X402_TOKEN_SYMBOLS,
		maxTimeoutSeconds: 60,
	},
	index: {
		priceUsd: 0.001,
		assets: X402_TOKEN_SYMBOLS,
		maxTimeoutSeconds: 60,
	},
};

export function getX402Price(surface: X402Surface): X402PriceConfig {
	return X402_PRICE_CATALOG[surface];
}

/**
 * Gas cost of one sponsored transfer in USD: `feeRate × bytes` µSTX → STX × spot.
 * Pure — callers feed live `/v2/fees/transfer` and STX/USD spot.
 */
export function computeGasFloorUsd(params: {
	feeRateUstxPerByte: number;
	txBytes: number;
	stxUsd: number;
}): number {
	const feeUstx = params.feeRateUstxPerByte * params.txBytes;
	const feeStx = feeUstx / 1_000_000;
	return feeStx * params.stxUsd;
}

/**
 * The dynamic per-call price floor: never below {@link X402_MIN_FLOOR_USD}, and
 * never below the live gas cost (so the rail is always gas-positive). A hardcoded
 * floor would invert under STX appreciation + fee-market congestion — hence the
 * `max`.
 */
export function resolvePriceFloorUsd(gasFloorUsd: number): number {
	return Math.max(X402_MIN_FLOOR_USD, gasFloorUsd);
}
