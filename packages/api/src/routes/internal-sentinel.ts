/**
 * `/internal/sentinel/*`: the service contract between Sentinel's worker (a
 * product on this platform, with its own sign-in and console) and the shared
 * secondlayer account + prepaid balance underneath it. Server-to-server only.
 *
 *   POST /accounts/resolve   { email }                                  find-or-create
 *   POST /accounts/grant     { accountId, usdMicros, reason, idempotencyKey }
 *   POST /accounts/summary   { accountId }                              balance, cap, prices
 *   POST /affordable         { accountId, unit, quantity }              pure check, no debit
 *   POST /checkout           { accountId, packUsd, returnPath }         Stripe Checkout URL
 *
 * Guard: `SENTINEL_SERVICE_KEY` ONLY (constant-time, unset key authenticates
 * nobody). `WORKLOAD_HOST_KEY` does not open these routes. Metering itself
 * goes through `/internal/meters`, which accepts the same key for `sentinel.*`
 * units. Prices are read from `PRICES`, never hard-coded here.
 */

import { grantCredits } from "@secondlayer/platform/billing/meter";
import {
	PRICES,
	USD_MICROS_PER_CENT,
} from "@secondlayer/platform/billing/prices";
import type { MeterUnit } from "@secondlayer/platform/billing/prices";
import {
	getCredits,
	getMonthlyCreditsSpend,
} from "@secondlayer/platform/db/queries/account-credits";
import { getCaps } from "@secondlayer/platform/db/queries/account-spend-caps";
import {
	findOrCreateAccountByEmail,
	getAccountById,
} from "@secondlayer/platform/db/queries/accounts";
import { getDb } from "@secondlayer/shared/db";
import {
	AuthenticationError,
	NotFoundError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { Hono } from "hono";
import { getStripeOrNull } from "../lib/stripe.ts";
import { InvalidJSONError } from "../middleware/error.ts";
import {
	type StripeClient,
	createCreditsCheckoutSession,
	isCreditPack,
} from "./billing.ts";
import { bearerToken, sentinelServiceKeyMatches } from "./internal-meters.ts";

/** Most a single grant may credit: $5, the starter credit. */
export const MAX_GRANT_USD_MICROS = 5_000_000n;

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
		const { account, created } = await findOrCreateAccountByEmail(
			getDb(),
			email,
		);
		return c.json({
			accountId: account.id,
			created,
			hadAccount: !created,
		});
	});

	app.post("/accounts/grant", async (c) => {
		const body = await readBody(c.req);
		const accountId = requireString(body, "accountId");
		const reason = requireString(body, "reason", 64);
		if (!/^[a-z0-9._-]+$/i.test(reason)) {
			throw new ValidationError("reason must be a short slug");
		}
		const idempotencyKey = requireString(body, "idempotencyKey");
		if (!idempotencyKey.startsWith("sentinel:")) {
			throw new ValidationError('idempotencyKey must start with "sentinel:"');
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
				`usdMicros exceeds the ${MAX_GRANT_USD_MICROS} per-grant cap`,
			);
		}
		await requireAccount(accountId);
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
		await requireAccount(accountId);
		const db = getDb();
		const [balance, spent, caps] = await Promise.all([
			getCredits(db, accountId),
			getMonthlyCreditsSpend(db, accountId),
			getCaps(db, accountId),
		]);
		return c.json({
			balanceUsdMicros: Number(balance),
			spentMonthUsdMicros: Number(spent),
			monthlyCapCents: caps?.monthly_cap_cents ?? null,
			prices: {
				run: Number(PRICES["sentinel.run"]),
				deep_audit: Number(PRICES["sentinel.deep_audit"]),
				monitored_event: Number(PRICES["sentinel.monitored_event"]),
			},
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
		await requireAccount(accountId);
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
		const packUsd = body.packUsd;
		if (typeof packUsd !== "number" || !isCreditPack(packUsd)) {
			throw new ValidationError("packUsd must be one of 10, 25, 50, 100");
		}
		const successUrl = buildReturnUrl(body.returnPath, "success");
		const cancelUrl = buildReturnUrl(body.returnPath, "cancelled");
		const account = await requireAccount(accountId);
		const stripe = getStripe();
		if (!stripe) return c.json({ error: "billing_not_configured" }, 503);
		const url = await createCreditsCheckoutSession({
			stripe,
			db: getDb(),
			account,
			usd: packUsd,
			successUrl,
			cancelUrl,
		});
		return c.json({ url });
	});

	return app;
}

export default createInternalSentinelRouter();
