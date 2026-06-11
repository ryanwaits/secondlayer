import { PaymentRequiredError } from "@secondlayer/shared/errors";
import {
	type X402Network,
	type X402TokenSymbol,
	X402_TOKENS,
	findX402TokenByAsset,
} from "@secondlayer/shared/x402";
import type { Context, MiddlewareHandler } from "hono";
import { getClientIp } from "../auth/http.ts";
import { getRateLimitStore } from "../auth/rate-limit-store.ts";
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
import {
	type OptimisticGate,
	getX402OptimisticGate,
} from "./optimistic-gate.ts";
import {
	getSessionSecret,
	mintSessionVoucher,
	verifySessionVoucher,
} from "./session.ts";
import { spotUsd } from "./spot.ts";

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
	/** Free-quota ladder: accountless requests under `limit` per `windowMs`
	 *  (keyed per client IP) fall through to the normal anonymous path instead
	 *  of a 402 challenge. Quota is only consulted when the rail is live, so
	 *  rail-off behavior is untouched. */
	freeQuota?: { limit: number; windowMs: number };
	/** Injectable quota store (tests); defaults to the shared rate-limit store. */
	quotaStore?: {
		check(
			key: string,
			limit: number,
			windowMs: number,
		): Promise<{ allowed: boolean }>;
	};
	/** Session pricing: one settled payment mints a `PAYMENT-SESSION` voucher
	 *  good for `maxCalls` further requests within `ttlMs` — the per-call 402
	 *  cycle only restarts when the session is exhausted or expired. */
	session?: { ttlMs: number; maxCalls: number; secret?: string };
	// Injectables (wiring + tests):
	facilitator?: X402Facilitator | null;
	nonceStore?: NonceStore;
	optimisticGate?: OptimisticGate;
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

/** Default spot source: env-configured USD price per whole token. USDCx is the
 *  dollar peg (handled in `buildAccepts`); STX/sBTC come from ops-set env vars,
 *  and are simply omitted from the offer when unset. */
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
	const spot = options.spot ?? spotUsd;
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
			// Session voucher: a prior payment on this surface bought a bounded
			// session — verify the signature + TTL statelessly, then spend one
			// unit of the session's call budget. Checked before the free quota
			// so paid sessions never burn the free allowance.
			const sessionCfg = options.session;
			const sessionSecret = sessionCfg?.secret ?? getSessionSecret();
			const sessionToken = c.req.header("PAYMENT-SESSION");
			if (sessionCfg && sessionSecret && sessionToken) {
				const voucher = verifySessionVoucher(sessionToken, sessionSecret);
				if (voucher && voucher.surface === options.surface) {
					const store = options.quotaStore ?? getRateLimitStore();
					const budget = await store.check(
						`x402sess:${voucher.id}`,
						sessionCfg.maxCalls,
						sessionCfg.ttlMs,
					);
					if (budget.allowed) return next();
				}
			}
			// Free-quota ladder: the first N anonymous calls per IP per window
			// stay free (normal anon rate limits still apply downstream); the
			// 402 only starts once the daily budget is spent.
			if (options.freeQuota) {
				const store = options.quotaStore ?? getRateLimitStore();
				const quota = await store.check(
					`x402free:${options.surface}:${getClientIp(c)}`,
					options.freeQuota.limit,
					options.freeQuota.windowMs,
				);
				if (quota.allowed) return next();
			}
			const nonce = generateNonce();
			const challenge: X402Challenge = {
				x402Version: X402_VERSION,
				accepts: buildAccepts({
					surface: options.surface,
					payTo,
					nonce,
					network: facilitator.network,
					spot,
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
			spot,
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

		// Optimistic for this surface? Only if the payer is within the per-principal
		// velocity + reputation gate (fails closed → confirmed-tier). Cheap public
		// reads (Index/Streams) default optimistic; high-value surfaces stay confirmed.
		const gate = options.optimisticGate ?? getX402OptimisticGate();
		const optimistic =
			cfg.finality === "optimistic" &&
			(await gate.canServeOptimistically(verdict.payer));

		const settlement: SettlementResponse = await facilitator.settle({
			txHex: verdict.txHex,
			payer: verdict.payer,
			recipient: payTo,
			amount: offer.amount,
			asset: verdict.asset,
			maxTimeoutSeconds: cfg.maxTimeoutSeconds,
			optimistic,
		});

		if (settlement.state === "pending") {
			// Confirmed-tier broadcast but not yet canonical — tell the client to retry.
			throw new PaymentRequiredError(
				"Payment broadcast; awaiting confirmation",
				{ reason: "awaiting_confirmation", txid: settlement.txid },
			);
		}

		// Record the payment (txid UNIQUE blocks double-redemption). Optimistic
		// serves land as `pending` in the ledger; the reconciler advances them.
		const insert = options.insertPayment ?? insertX402Payment;
		await insert({
			nonce,
			txid: settlement.txid,
			asset: payment.asset,
			amount: offer.amount,
			payer: verdict.payer,
			surface: options.surface,
			state: settlement.state === "confirmed" ? "confirmed" : "pending",
		});

		c.header(
			"PAYMENT-RESPONSE",
			b64encode({
				success: true,
				state: settlement.state, // "confirmed" | "optimistic"
				txid: settlement.txid,
				payer: settlement.payer,
				network: settlement.network,
			}),
		);
		// Session surfaces: this payment opens a bounded session — hand the
		// voucher back so the client's next polls skip the 402 cycle.
		const mintCfg = options.session;
		const mintSecret = mintCfg?.secret ?? getSessionSecret();
		if (mintCfg && mintSecret) {
			c.header(
				"PAYMENT-SESSION",
				mintSessionVoucher(
					{
						v: 1,
						id: nonce,
						surface: options.surface,
						payer: verdict.payer,
						exp: Date.now() + mintCfg.ttlMs,
					},
					mintSecret,
				),
			);
		}
		return next();
	};
}
