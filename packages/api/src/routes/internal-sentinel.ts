/**
 * `/internal/sentinel/*`: the service contract between Sentinel's worker (a
 * product on this platform, with its own sign-in and console) and the shared
 * secondlayer account + prepaid balance underneath it. Server-to-server only.
 *
 *   POST /accounts/resolve   { email }                                  find-or-create (+ linked)
 *   POST /accounts/link      { accountId }                              owner opted in (via consent)
 *   POST /accounts/grant     { accountId, usdMicros, reason, idempotencyKey }
 *   POST /accounts/summary   { accountId }                              balance, owed, cap, refill, prices
 *   POST /accounts/settle    { accountId }                              collect owed sentinel.* usage
 *   POST /settings           { accountId, monthlyCapCents?, refill? }   cap + auto top-up
 *   POST /affordable         { accountId, unit, quantity }              pure check, no debit
 *   POST /checkout           { accountId, packUsd, returnPath }         Stripe Checkout URL
 *
 * Guard: `SENTINEL_SERVICE_KEY` ONLY (constant-time, unset key authenticates
 * nobody). `WORKLOAD_HOST_KEY` does not open these routes. Metering itself
 * goes through `/internal/meters`, which accepts the same key for `sentinel.*`
 * units. Every route past resolve/link also requires the account to be in
 * `sentinel_accounts` (created by Sentinel, or linked with consent), else 403
 * `account_not_linked`: a leaked key can't touch an arbitrary account. Prices are read from `PRICES`, never hard-coded here.
 */

import {
	grantCredits,
	settleOwedSentinel,
} from "@secondlayer/platform/billing/meter";
import {
	PRICES,
	USD_MICROS_PER_CENT,
} from "@secondlayer/platform/billing/prices";
import type { MeterUnit } from "@secondlayer/platform/billing/prices";
import {
	getCreditRefill,
	getCredits,
	getMonthlyCreditsSpend,
	setCreditRefill,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	findOrCreateAccountByEmail,
	getAccountById,
	isSentinelLinked,
	linkSentinelAccount,
} from "@secondlayer/platform/db/queries/accounts";
import { owedSentinelUsdMicros } from "@secondlayer/platform/db/queries/usage-ledger";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getStripeOrNull } from "../lib/stripe.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import {
	SENTINEL_TOPUP_MAX_USD,
	SENTINEL_TOPUP_MIN_USD,
	type StripeClient,
	applyMonthlyCap,
	createCreditsCheckoutSession,
	isSentinelTopupUsd,
	parseRefillInput,
} from "./billing.ts";
import { bearerToken, sentinelServiceKeyMatches } from "./internal-meters.ts";

/** Sentinel's starter credit. An account can receive two Sentinel grants, each
 *  under a fixed per-account key: the starter, and a one-time top-up for accounts
 *  that got the earlier $5 starter. Together they never exceed this, ever. */
export const MAX_GRANT_USD_MICROS = 10_000_000n;
const GRANT_KEY_KINDS = ["starter", "starter-topup"] as const;
const grantKeys = (accountId: string) =>
	GRANT_KEY_KINDS.map((kind) => `sentinel:${kind}:${accountId}`);

/** What Sentinel already granted this account, excluding `exceptKey` (a retry of
 *  that grant is idempotent and must not count against itself). */
async function sentinelGrantedUsdMicros(
	accountId: string,
	exceptKey: string,
): Promise<bigint> {
	const rows = await getDb()
		.selectFrom("usage_ledger")
		.select("usd_micros")
		.where("account_id", "=", accountId)
		.where("unit", "=", "grant")
		.where(
			"idempotency_key",
			"in",
			grantKeys(accountId).filter((k) => k !== exceptKey),
		)
		.execute();
	return rows.reduce((sum, r) => sum - BigInt(String(r.usd_micros)), 0n);
}

const DEFAULT_SENTINEL_WEB_URL = "https://runsentinel.app";

type SentinelUnit = Extract<MeterUnit, `sentinel.${string}`>;
const SENTINEL_UNITS: SentinelUnit[] = [
	"sentinel.run",
	"sentinel.deep_audit",
	"sentinel.monitored_event",
];

/** Accept `sentinel.run` or the short `run`. */
function parseSentinelUnit(raw: unknown): SentinelUnit {
	if (typeof raw === "string") {
		const full = raw.startsWith("sentinel.") ? raw : `sentinel.${raw}`;
		const hit = SENTINEL_UNITS.find((u) => u === full);
		if (hit) return hit;
	}
	throw new ValidationError(`unit must be one of ${SENTINEL_UNITS.join(", ")}`);
}

/**
 * Build the Stripe return URL from the allow-listed Sentinel origin plus a
 * path. The path must start with a single `/` (no `//`, no backslash, no
 * control characters) and must resolve to the same origin: anything else is
 * an open-redirect attempt and is refused.
 */
export function buildReturnUrl(
	returnPath: unknown,
	result: "success" | "cancelled",
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (
		typeof returnPath !== "string" ||
		!returnPath.startsWith("/") ||
		returnPath.startsWith("//") ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
		/[\\\u0000-\u001f\u007f]/.test(returnPath)
	) {
		throw new ValidationError(
			"returnPath must be a path starting with a single /",
		);
	}
	const origin = new URL(
		env.SENTINEL_WEB_URL?.trim() || DEFAULT_SENTINEL_WEB_URL,
	).origin;
	const url = new URL(returnPath, origin);
	if (url.origin !== origin) {
		throw new ValidationError("returnPath must stay on the Sentinel origin");
	}
	url.searchParams.set("topup", result);
	return url.toString();
}

async function readBody(req: {
	json: () => Promise<unknown>;
}): Promise<Record<string, unknown>> {
	const body = await req.json().catch(() => {
		throw new InvalidJSONError();
	});
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new ValidationError("body must be a JSON object");
	}
	return body as Record<string, unknown>;
}

function requireString(
	body: Record<string, unknown>,
	field: string,
	max = 256,
): string {
	const v = body[field];
	if (typeof v !== "string" || v.trim().length === 0 || v.length > max) {
		throw new ValidationError(`${field} is required`);
	}
	return v;
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Existing account that Sentinel may touch, else 404 / 403 account_not_linked. */
async function requireLinkedAccount(accountId: string) {
	const account = await requireAccount(accountId);
	if (!(await isSentinelLinked(getDb(), accountId))) {
		throw new ForbiddenError("account_not_linked");
	}
	return account;
}

async function requireAccount(accountId: string) {
	const account = UUID_RE.test(accountId)
		? await getAccountById(getDb(), accountId)
		: null;
	if (!account) throw new NotFoundError("Account not found");
	return account;
}

export function createInternalSentinelRouter(
	deps: { getStripe?: () => StripeClient | null } = {},
) {
	const getStripe = deps.getStripe ?? getStripeOrNull;
	const app = new Hono();

	app.use("*", async (c, next) => {
		const key = bearerToken(c.req.header("authorization"));
		if (!key || !sentinelServiceKeyMatches(key)) {
			throw new AuthenticationError("Missing or invalid Authorization header", {
				hint: "Send the Sentinel service key as `Authorization: Bearer $SENTINEL_SERVICE_KEY`.",
				env_var: "SENTINEL_SERVICE_KEY",
			});
		}
		await next();
	});

	app.post("/accounts/resolve", async (c) => {
		const body = await readBody(c.req);
		const email = requireString(body, "email", 320);
		if (!email.includes("@")) throw new ValidationError("email is invalid");
		const db = getDb();
		const { account, created, linked } = await db
			.transaction()
			.execute(async (trx) => {
				const found = await findOrCreateAccountByEmail(trx, email);
				// Only an account Sentinel itself created is linked here; an
				// existing account waits for /accounts/link (owner consent).
				if (found.created) {
					await linkSentinelAccount(trx, found.account.id, "created");
					return { ...found, linked: true };
				}
				return {
					...found,
					linked: await isSentinelLinked(trx, found.account.id),
				};
			});
		return c.json({
			accountId: account.id,
			created,
			hadAccount: !created,
			linked,
		});
	});

	app.post("/accounts/link", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		await requireAccount(accountId);
		await linkSentinelAccount(getDb(), accountId, "consent");
		return c.json({ linked: true });
	});

	app.post("/accounts/grant", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		const reason = requireString(body, "reason", 64);
		if (!/^[a-z0-9._-]+$/i.test(reason)) {
			throw new ValidationError("reason must be a short slug");
		}
		const idempotencyKey = requireString(body, "idempotencyKey");
		if (!grantKeys(accountId).includes(idempotencyKey)) {
			throw new ValidationError(
				'idempotencyKey must be "sentinel:starter:<accountId>" or "sentinel:starter-topup:<accountId>"',
			);
		}
		const amount = body.usdMicros;
		if (
			typeof amount !== "number" ||
			!Number.isSafeInteger(amount) ||
			amount <= 0
		) {
			throw new ValidationError("usdMicros must be a positive integer");
		}
		const usdMicros = BigInt(amount);
		if (usdMicros > MAX_GRANT_USD_MICROS) {
			throw new ValidationError(
				`usdMicros exceeds the ${MAX_GRANT_USD_MICROS} starter-grant cap`,
			);
		}
		await requireLinkedAccount(accountId);
		const prior = await sentinelGrantedUsdMicros(accountId, idempotencyKey);
		if (prior + usdMicros > MAX_GRANT_USD_MICROS) {
			return c.json(
				{
					error: "grant_total_exceeded",
					message: `Sentinel grants to this account would exceed ${MAX_GRANT_USD_MICROS} in total`,
				},
				409,
			);
		}
		const result = await grantCredits(getDb(), {
			accountId,
			usdMicros,
			source: `sentinel:${reason}`,
			idempotencyKey,
		});
		return c.json({
			granted: result.granted,
			balanceAfter: Number(result.balance),
		});
	});

	app.post("/accounts/summary", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		await requireLinkedAccount(accountId);
		const db = getDb();
		const [balance, spent, caps, owed, refill] = await Promise.all([
			getCredits(db, accountId),
			getMonthlyCreditsSpend(db, accountId),
			getCaps(db, accountId),
			owedSentinelUsdMicros(db, accountId),
			getCreditRefill(db, accountId),
		]);
		return c.json({
			balanceUsdMicros: Number(balance),
			spentMonthUsdMicros: Number(spent),
			owedUsdMicros: Number(owed),
			monthlyCapCents: caps?.monthly_cap_cents ?? null,
			refill:
				refill.belowUsdMicros != null && refill.packUsd != null
					? {
							belowUsd: Number(refill.belowUsdMicros) / 1_000_000,
							packUsd: refill.packUsd,
						}
					: null,
			prices: {
				run: Number(PRICES["sentinel.run"]),
				deep_audit: Number(PRICES["sentinel.deep_audit"]),
				monitored_event: Number(PRICES["sentinel.monitored_event"]),
			},
		});
	});

	app.post("/accounts/settle", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		await requireLinkedAccount(accountId);
		const result = await settleOwedSentinel(getDb(), accountId);
		return c.json({
			settledUsdMicros: Number(result.settledUsdMicros),
			owedUsdMicros: Number(result.owedUsdMicros),
			balanceUsdMicros: Number(result.balanceUsdMicros),
		});
	});

	app.post("/settings", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");

		// Validate everything before writing anything.
		let cap: { cents: number | null } | undefined;
		if (body.monthlyCapCents !== undefined) {
			const cents = body.monthlyCapCents;
			if (
				cents !== null &&
				(typeof cents !== "number" || !Number.isSafeInteger(cents) || cents < 0)
			) {
				throw new ValidationError(
					"monthlyCapCents must be a non-negative integer or null",
				);
			}
			cap = { cents };
		}
		let refill: ReturnType<typeof parseRefillInput> | undefined;
		if (body.refill !== undefined) {
			const r = body.refill;
			if (typeof r !== "object" || r === null || Array.isArray(r)) {
				throw new ValidationError("refill must be an object");
			}
			const input = r as Record<string, unknown>;
			if (!("belowUsd" in input)) {
				throw new ValidationError("refill.belowUsd is required (or null)");
			}
			refill = parseRefillInput(input);
			if (!refill.ok) throw new ValidationError(refill.error);
		}

		await requireLinkedAccount(accountId);
		const db = getDb();
		if (cap) await applyMonthlyCap(db, accountId, cap.cents);
		if (refill?.ok) {
			await setCreditRefill(db, accountId, {
				belowUsdMicros: refill.belowUsdMicros,
				packUsd: refill.packUsd,
			});
		}
		const [caps, current] = await Promise.all([
			getCaps(db, accountId),
			getCreditRefill(db, accountId),
		]);
		return c.json({
			monthlyCapCents: caps?.monthly_cap_cents ?? null,
			refill:
				current.belowUsdMicros != null && current.packUsd != null
					? {
							belowUsd: Number(current.belowUsdMicros) / 1_000_000,
							packUsd: current.packUsd,
						}
					: null,
		});
	});

	app.post("/affordable", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		const unit = parseSentinelUnit(body.unit);
		const quantity = body.quantity;
		if (
			typeof quantity !== "number" ||
			!Number.isSafeInteger(quantity) ||
			quantity <= 0
		) {
			throw new ValidationError("quantity must be a positive integer");
		}
		await requireLinkedAccount(accountId);
		const db = getDb();
		const price = PRICES[unit] * BigInt(quantity);
		const [balance, spent, caps] = await Promise.all([
			getCredits(db, accountId),
			getMonthlyCreditsSpend(db, accountId),
			getCaps(db, accountId),
		]);
		let reason: "balance" | "cap" | undefined;
		if (balance < price) reason = "balance";
		else if (
			caps?.monthly_cap_cents != null &&
			spent + price > BigInt(caps.monthly_cap_cents) * USD_MICROS_PER_CENT
		) {
			reason = "cap";
		}
		return c.json({
			ok: reason === undefined,
			priceUsdMicros: Number(price),
			balanceUsdMicros: Number(balance),
			...(reason ? { reason } : {}),
		});
	});

	app.post("/checkout", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		// `amountUsd`: any whole-dollar top-up in range; `packUsd` is the older name for the same field.
		const usd = body.amountUsd ?? body.packUsd;
		if (!isSentinelTopupUsd(usd)) {
			throw new ValidationError(
				`amountUsd must be a whole number from ${SENTINEL_TOPUP_MIN_USD} to ${SENTINEL_TOPUP_MAX_USD}`,
			);
		}
		const successUrl = buildReturnUrl(body.returnPath, "success");
		const cancelUrl = buildReturnUrl(body.returnPath, "cancelled");
		const account = await requireLinkedAccount(accountId);
		const stripe = getStripe();
		if (!stripe) return c.json({ error: "billing_not_configured" }, 503);
		const url = await createCreditsCheckoutSession({
			stripe,
			db: getDb(),
			account,
			usd,
			successUrl,
			cancelUrl,
		});
		return c.json({ url });
	});

	return app;
}

export default createInternalSentinelRouter();
