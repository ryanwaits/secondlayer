import type { getDb } from "@secondlayer/shared/db";
import { AuthorizationError } from "@secondlayer/shared/errors";
import { generateApiKey } from "./keys.ts";

export type MintProduct = "account" | "streams" | "index";

/**
 * The single tier every minted key gets. Plan/tier selection is retired —
 * the metered archive has one tier, and the credit-gated read path
 * (`lib/read-credits.ts` — `tier === "free"`) meters exactly this value.
 */
export const DEFAULT_MINT_TIER = "free";

/**
 * Cap on active (non-revoked) keys per account. A backstop against key-spray
 * via the agent-reachable mint endpoint; the per-IP rate limit is the first
 * line of defence. Revoked keys don't count. Env-overridable.
 */
const MAX_ACTIVE_KEYS = Number.parseInt(
	process.env.API_KEYS_MAX_ACTIVE_PER_ACCOUNT ?? "50",
	10,
);

/**
 * The credential that authenticated the mint request. `isSession` is true for a
 * dashboard session token; otherwise `apiKeyProduct` is the `product` of the
 * presenting API key.
 */
export type MintCaller = { isSession: boolean; apiKeyProduct?: string | null };

/**
 * Only an owner credential may create API keys: a dashboard session, or an
 * `account`-product key (which grants both streams + index reads). A scoped
 * `streams`/`index` key must NOT be able to mint — otherwise any leaked read
 * key is a privilege-escalation vector. `requireAuth` itself does no such check.
 */
export function assertCanMint(caller: MintCaller): void {
	if (!caller.isSession && caller.apiKeyProduct !== "account") {
		throw new AuthorizationError(
			"Only an account-level credential can create API keys; scoped streams/index keys cannot.",
		);
	}
}

/**
 * Product of the key to mint. Sessions (dashboard) may mint any product;
 * non-session (account-key) callers may only mint scoped read keys, never
 * another `account` superkey.
 */
export function resolveMintProduct(
	caller: MintCaller,
	requested: MintProduct | undefined,
): MintProduct {
	if (caller.isSession) return requested ?? "account";
	if (requested && requested !== "streams" && requested !== "index") {
		throw new AuthorizationError(
			"API-key callers can only create scoped streams/index keys, not account keys.",
		);
	}
	return requested ?? "streams";
}

/** Throw if the account is already at its active-key ceiling. */
export async function assertUnderKeyCeiling(
	db: ReturnType<typeof getDb>,
	accountId: string,
): Promise<void> {
	const row = await db
		.selectFrom("api_keys")
		.select((eb) => eb.fn.countAll<string>().as("active"))
		.where("account_id", "=", accountId)
		.where("status", "=", "active")
		.executeTakeFirstOrThrow();
	if (Number(row.active) >= MAX_ACTIVE_KEYS) {
		throw new AuthorizationError(
			`Account has reached the active API-key limit (${MAX_ACTIVE_KEYS}). Revoke an unused key first.`,
		);
	}
}

export type MintedKey = {
	key: string;
	prefix: string;
	id: string;
	product: string;
	tier: string | null;
	createdAt: string;
};

/** Insert a new key and return the plaintext ONCE (only the hash is stored).
 * Every key is minted at `DEFAULT_MINT_TIER` — there is no tier selection. */
export async function mintApiKey(
	db: ReturnType<typeof getDb>,
	input: {
		accountId: string;
		name?: string | null;
		product: MintProduct;
		ip: string;
	},
): Promise<MintedKey> {
	const { raw, hash, prefix } = generateApiKey();
	const key = await db
		.insertInto("api_keys")
		.values({
			key_hash: hash,
			key_prefix: prefix,
			name: input.name ?? null,
			ip_address: input.ip,
			account_id: input.accountId,
			status: "active",
			product: input.product,
			tier: DEFAULT_MINT_TIER,
		})
		.returningAll()
		.executeTakeFirstOrThrow();
	return {
		key: raw,
		prefix,
		id: key.id,
		product: key.product,
		tier: key.tier,
		createdAt: key.created_at.toISOString(),
	};
}
