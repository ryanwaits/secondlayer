import { PaymentRequiredError } from "@secondlayer/shared/errors";
import {
	type X402Network,
	type X402TokenSymbol,
	X402_TOKENS,
	findX402TokenByAsset,
} from "@secondlayer/shared/x402";
import type { Context, MiddlewareHandler } from "hono";
import { type X402Surface, getX402Price } from "./catalog.ts";
import {
	type SettlementResponse,
	type VerifyResult,
	type X402Facilitator,
	getX402FacilitatorOrNull,
	verifyPayment,
} from "./facilitator.ts";
import { insertX402Payment } from "./ledger.ts";
import { type NonceStore, getX402NonceStore } from "./nonce-store.ts";

/**
 * `x402PaymentRequired({surface})` — Hono per-surface middleware mounted AFTER
 * bearerAuth, BEFORE rateLimit. Account-backed callers (a resolved tenant on the
 * context) skip x402 entirely — they pay via Stripe. Accountless callers get the
 * full x402 v2 handshake: no `PAYMENT-SIGNATURE` → 402 + `PAYMENT-REQUIRED`
 * challenge; with one → verify → settle (confirmed-tier) → ledger → 200 +
 * `PAYMENT-RESPONSE` receipt.
 */

const X402_VERSION = 2;

export type X402Accept = {
	scheme: "exact";
	network: X402Network;
	asset: string;
	/** Atomic units. */
	amount: string;
	payTo: string;
	maxTimeoutSeconds: number;
	extra: { nonce: string };
};

export type X402Challenge = {
	x402Version: number;
	accepts: X402Accept[];
	error?: string;
};

/** USD price per 1 whole token; `null` → asset can't be priced (omitted). */
export type SpotResolver = (symbol: X402TokenSymbol) => number | null;

export type X402MiddlewareOptions = {
	surface: X402Surface;
	/** Recipient principal — defaults to the facilitator's `X402_PAY_TO`. */
	payTo?: string;
	// Injectables (wiring + tests):
	facilitator?: X402Facilitator | null;
	nonceStore?: NonceStore;
	spot?: SpotResolver;
	/** Override account-backed detection (default: a resolved tenant on ctx). */
	isAccountBacked?: (c: Context) => boolean;
	insertPayment?: typeof insertX402Payment;
	generateNonce?: () => string;
};

function b64encode(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function b64decode<T>(value: string): T | null {
	try {
		return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
	} catch {
		return null;
	}
}

/** A resolved tenant on the context means a paying (account-backed) caller. */
function defaultIsAccountBacked(c: Context): boolean {
	return Boolean(
		// biome-ignore lint/suspicious/noExplicitAny: surface tenant keys aren't in this middleware's generic env
		(c as any).get?.("indexTenant") ?? (c as any).get?.("streamsTenant"),
	);
}

/** Build the `accepts[]` for a surface. USDCx is the dollar peg (no oracle);
 *  STX/sBTC need a spot price or they are omitted from the offer. */
export function buildAccepts(opts: {
	surface: X402Surface;
	payTo: string;
	nonce: string;
	network: X402Network;
	spot?: SpotResolver;
}): X402Accept[] {
	const cfg = getX402Price(opts.surface);
	const accepts: X402Accept[] = [];
	for (const symbol of cfg.assets) {
		const token = X402_TOKENS[symbol];
		const usdPerToken = symbol === "USDCx" ? 1 : (opts.spot?.(symbol) ?? null);
		if (usdPerToken === null || usdPerToken <= 0) continue;
		const wholeTokens = cfg.priceUsd / usdPerToken;
		const atomic = BigInt(Math.ceil(wholeTokens * 10 ** token.decimals));
		accepts.push({
			scheme: "exact",
			network: opts.network,
			asset: token.asset,
			amount: atomic.toString(),
			payTo: opts.payTo,
			maxTimeoutSeconds: cfg.maxTimeoutSeconds,
			extra: { nonce: opts.nonce },
		});
	}
	return accepts;
}

type X402PaymentPayload = {
	x402Version: number;
	scheme: "exact";
	network: X402Network;
	asset: string;
	payload: { transaction: string };
	extra?: { nonce?: string };
};

export function x402PaymentRequired(
	options: X402MiddlewareOptions,
): MiddlewareHandler {
	const isAccountBacked = options.isAccountBacked ?? defaultIsAccountBacked;
	// 32 hex chars (32 bytes) — fits the 34-byte on-chain memo the nonce rides in.
	const generateNonce =
		options.generateNonce ?? (() => crypto.randomUUID().replace(/-/g, ""));

	return async (c, next) => {
		// Paying customers (resolved tenant) bypass x402 entirely.
		if (isAccountBacked(c)) return next();

		const facilitator = options.facilitator ?? getX402FacilitatorOrNull();
		if (!facilitator) {
			// No sponsor configured → the rail is unavailable (not a 402).
			return c.json(
				{
					error: "x402 payment rail is not configured",
					code: "PAYMENT_RAIL_UNAVAILABLE",
				},
				503,
			);
		}
		const payTo = options.payTo ?? facilitator.payTo;
		if (!payTo) {
			return c.json(
				{
					error: "x402 payTo is not configured",
					code: "PAYMENT_RAIL_UNAVAILABLE",
				},
				503,
			);
		}

		const nonceStore = options.nonceStore ?? getX402NonceStore();
		const cfg = getX402Price(options.surface);
		const sigHeader = c.req.header("PAYMENT-SIGNATURE");

		// ── Challenge step: no payment yet → 402 + PAYMENT-REQUIRED ──
		if (!sigHeader) {
			const nonce = generateNonce();
			const challenge: X402Challenge = {
				x402Version: X402_VERSION,
				accepts: buildAccepts({
					surface: options.surface,
					payTo,
					nonce,
					network: facilitator.network,
					spot: options.spot,
				}),
			};
			c.header("PAYMENT-REQUIRED", b64encode(challenge));
			return c.json(challenge, 402);
		}

		// ── Retry step: decode + verify + settle ──
		const payment = b64decode<X402PaymentPayload>(sigHeader);
		if (!payment?.payload?.transaction || !payment.asset) {
			throw new PaymentRequiredError("Malformed PAYMENT-SIGNATURE", {
				reason: "malformed_payment",
			});
		}
		const token = findX402TokenByAsset(payment.asset);
		if (!token) {
			throw new PaymentRequiredError("Unsupported asset", {
				reason: "unsupported_asset",
			});
		}
		// The amount required for the chosen asset, recomputed (never trust client).
		const accepts = buildAccepts({
			surface: options.surface,
			payTo,
			nonce: payment.extra?.nonce ?? "",
			network: facilitator.network,
			spot: options.spot,
		});
		const offer = accepts.find((a) => a.asset === payment.asset);
		if (!offer) {
			throw new PaymentRequiredError("Asset not offered for this surface", {
				reason: "unsupported_asset",
			});
		}
		const nonce = payment.extra?.nonce;
		if (!nonce) {
			throw new PaymentRequiredError("Missing challenge nonce", {
				reason: "missing_nonce",
			});
		}

		const verdict: VerifyResult = verifyPayment(payment.payload.transaction, {
			payTo,
			amount: offer.amount,
			asset: token,
			network: facilitator.network,
			nonce,
		});
		if (!verdict.ok) {
			throw new PaymentRequiredError(
				`Payment verification failed: ${verdict.reason}`,
				{
					reason: verdict.reason,
				},
			);
		}

		// Claim the nonce (NX, fail-closed) — a replay of the same challenge is rejected.
		const fresh = await nonceStore.consume(
			`nonce:${nonce}`,
			cfg.maxTimeoutSeconds * 1000,
		);
		if (!fresh) {
			throw new PaymentRequiredError("Challenge nonce already used", {
				reason: "nonce_replayed",
			});
		}

		const settlement: SettlementResponse = await facilitator.settle({
			txHex: verdict.txHex,
			payer: verdict.payer,
			recipient: payTo,
			amount: offer.amount,
			asset: verdict.asset,
			maxTimeoutSeconds: cfg.maxTimeoutSeconds,
		});

		if (settlement.state !== "confirmed") {
			// Broadcast but not yet canonical — tell the client to retry later.
			throw new PaymentRequiredError(
				"Payment broadcast; awaiting confirmation",
				{
					reason: "awaiting_confirmation",
					txid: settlement.txid,
				},
			);
		}

		// Record the settled payment (txid UNIQUE blocks double-redemption).
		const insert = options.insertPayment ?? insertX402Payment;
		await insert({
			nonce,
			txid: settlement.txid,
			asset: payment.asset,
			amount: offer.amount,
			payer: verdict.payer,
			surface: options.surface,
			state: "confirmed",
		});

		c.header(
			"PAYMENT-RESPONSE",
			b64encode({
				success: true,
				txid: settlement.txid,
				payer: settlement.payer,
				network: settlement.network,
			}),
		);
		return next();
	};
}
