import type { getDb } from "@secondlayer/shared/db";
import { revokeApiKey } from "@secondlayer/shared/db/queries/api-keys";
import {
	AuthorizationError,
	ValidationError,
} from "@secondlayer/shared/errors";
import { liveKeyWhere } from "./key-state.ts";
import { SENTINEL_KEY_PREFIX, generateApiKey } from "./keys.ts";

export type MintProduct = "account" | "sentinel" | "docs" | "tenant";

export const DEFAULT_MINT_TIER = "free";

/**
 * The first-party tier: reads are neither throttled nor metered. Only the
 * workload host's per-tenant `hosted-stack` key gets it (minted by
 * `routes/internal-tenant-key.ts`, behind the workload host key): a hosted
 * webhook evaluator's Index/Streams reads are our cost, covered by the
 * per-event webhook price, never the customer's rows. Customers can't set a
 * tier on a key, so this can't be claimed from outside.
 */
export const INTERNAL_MINT_TIER = "internal";

/**
 * Cap on active (non-revoked) keys per account, enforced by
 * `assertUnderKeyCeiling` in POST /api/keys and the sentinel mint. A backstop
 * against key-spray via the agent-reachable mint endpoint; POST /api/keys
 * also rate-limits creates per account (routes.ts). Revoked and docs keys
 * don't count.
 */
const MAX_ACTIVE_KEYS = 50;

export type MintCaller = { isSession: boolean; apiKeyProduct?: string | null };

export function assertCanMint(caller: MintCaller): void {
	if (!caller.isSession && caller.apiKeyProduct !== "account") {
		throw new AuthorizationError(
			"Only an account-level credential can create API keys; scoped streams/index keys cannot.",
		);
	}
}

export function resolveMintProduct(
	_caller: MintCaller,
	requested: MintProduct | string | undefined,
): MintProduct {
	if (requested === "streams" || requested === "index") {
		throw new ValidationError(
			"mint account keys only; scoped streams/index keys are retired.",
		);
	}
	return "account";
}

export async function assertUnderKeyCeiling(
	db: ReturnType<typeof getDb>,
	accountId: string,
): Promise<void> {
	const row = await db
		.selectFrom("api_keys")
		.select((eb) => eb.fn.countAll<string>().as("active"))
		.where("account_id", "=", accountId)
		.where(liveKeyWhere())
		.where("product", "!=", "docs")
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

export async function mintApiKey(
	db: ReturnType<typeof getDb>,
	input: {
		accountId: string;
		name?: string | null;
		product: MintProduct;
		areas?: Record<string, string>;
		ip: string;
		internal?: boolean;
		expiresAt?: Date;
	},
): Promise<MintedKey> {
	const { raw, hash, prefix } = generateApiKey(
		input.product === "sentinel" ? SENTINEL_KEY_PREFIX : undefined,
	);
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
			areas: input.areas ?? null,
			tier: input.internal ? INTERNAL_MINT_TIER : DEFAULT_MINT_TIER,
			expires_at: input.expiresAt ?? null,
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

export async function revokeKeysByName(
	db: ReturnType<typeof getDb>,
	accountId: string,
	name: string,
): Promise<void> {
	const now = new Date();
	const rows = await db
		.selectFrom("api_keys")
		.select("id")
		.where("account_id", "=", accountId)
		.where("name", "=", name)
		.where("product", "=", "tenant")
		.where("status", "=", "active")
		.execute();
	for (const { id } of rows) await revokeApiKey(db, id, now);
}

export const DOCS_KEY_TTL_MS = 24 * 60 * 60 * 1000;
export const DOCS_KEY_NAME = "Docs key";
export const DOCS_KEY_DAILY_LIMIT = 10;

/**
 * Mint the account's docs key: revoke any previous active docs key, then mint a
 * fresh `docs`-product key that expires in 24h. One transaction, so an account
 * never has two active docs keys (a partial unique index backs this up). Given
 * a transaction, it runs inside it (the signed-out mint creates the ghost
 * account in the same one).
 */
export async function mintDocsKey(
	db: ReturnType<typeof getDb>,
	input: { accountId: string; ip: string; now?: Date },
): Promise<MintedKey & { expiresAt: string }> {
	const now = input.now ?? new Date();
	const expiresAt = new Date(now.getTime() + DOCS_KEY_TTL_MS);
	const inTransaction = <T>(
		run: (trx: ReturnType<typeof getDb>) => Promise<T>,
	): Promise<T> => (db.isTransaction ? run(db) : db.transaction().execute(run));
	const minted = await inTransaction(async (trx) => {
		const previous = await trx
			.selectFrom("api_keys")
			.select("id")
			.where("account_id", "=", input.accountId)
			.where("product", "=", "docs")
			.where("status", "=", "active")
			.execute();
		for (const { id } of previous) await revokeApiKey(trx, id, now);
		return mintApiKey(trx, {
			accountId: input.accountId,
			name: DOCS_KEY_NAME,
			product: "docs",
			ip: input.ip,
			expiresAt,
		});
	});
	return { ...minted, expiresAt: expiresAt.toISOString() };
}

export type RotateKeyResult =
	| {
			ok: true;
			minted: MintedKey & { name: string | null; rotatedFrom: string };
	  }
	| { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Replace a key's secret: revoke it and mint its successor in one transaction,
 * keeping the name, product and tier. A new row, not a new hash on the old one:
 * the old secret must keep resolving to a revoked row so callers get
 * KEY_REVOKED. The row lock makes concurrent rotates of one key mint one key.
 */
export async function rotateApiKey(
	db: ReturnType<typeof getDb>,
	input: { accountId: string; id: string; ip: string },
	mint: typeof mintApiKey = mintApiKey,
): Promise<RotateKeyResult> {
	return db.transaction().execute(async (trx) => {
		const old = await trx
			.selectFrom("api_keys")
			.selectAll()
			.where("id", "=", input.id)
			.forUpdate()
			.executeTakeFirst();
		if (!old) return { ok: false, status: 404, error: "Key not found" };
		if (old.account_id !== input.accountId) {
			return {
				ok: false,
				status: 403,
				error: "Cannot rotate keys from a different account",
			};
		}
		if (old.status !== "active") {
			return {
				ok: false,
				status: 409,
				error: "This key is already revoked. Rotate an active key.",
			};
		}
		if (old.product !== "account") {
			return {
				ok: false,
				status: 409,
				error: "Only account keys can be rotated.",
			};
		}
		const revoked = await revokeApiKey(trx, old.id);
		if (revoked === null) {
			return {
				ok: false,
				status: 409,
				error: "This key is already revoked. Rotate an active key.",
			};
		}
		const minted = await mint(trx, {
			accountId: input.accountId,
			name: old.name,
			product: "account",
			ip: input.ip,
			internal: old.tier === INTERNAL_MINT_TIER,
		});
		return {
			ok: true,
			minted: { ...minted, name: old.name, rotatedFrom: old.id },
		};
	});
}
