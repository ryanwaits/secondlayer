import { ForbiddenError, StreamNotFoundError } from "@secondlayer/shared";
import type { Database } from "@secondlayer/shared/db";
import { getDb } from "@secondlayer/shared/db";
import type { Context } from "hono";
import type { Kysely } from "kysely";

/**
 * Get all api_key_ids belonging to the same account as the current key.
 * Enables account-level resource scoping across key rotations.
 */
export async function getAccountKeyIds(
	db: Kysely<Database>,
	accountId: string,
): Promise<string[]> {
	const keys = await db
		.selectFrom("api_keys")
		.select("id")
		.where("account_id", "=", accountId)
		.where("status", "=", "active")
		.execute();
	return keys.map((k) => k.id);
}

/**
 * Assert the authenticated account owns the given stream.
 * Checks against all API keys belonging to the account.
 * Returns the stream row on success.
 * Throws 404 if not found, 403 if owned by another account.
 */
export async function assertStreamOwnership(
	db: Kysely<Database>,
	streamId: string,
	accountKeyIds: string[] | undefined,
) {
	const stream = await db
		.selectFrom("streams")
		.selectAll()
		.where("id", "=", streamId)
		.executeTakeFirst();

	if (!stream) {
		throw new StreamNotFoundError(streamId);
	}

	if (accountKeyIds && !accountKeyIds.includes(stream.api_key_id)) {
		throw new ForbiddenError("Stream belongs to another account");
	}

	return stream;
}

/**
 * Assert the authenticated account owns the given subgraph.
 * Returns the subgraph row on success.
 * Throws 404 if not found, 403 if owned by another account.
 */
export async function assertSubgraphOwnership(
	db: Kysely<Database>,
	subgraphName: string,
	accountId: string | undefined,
) {
	const subgraph = await db
		.selectFrom("subgraphs")
		.selectAll()
		.where("name", "=", subgraphName)
		.executeTakeFirst();

	if (!subgraph) return null;

	if (accountId && subgraph.account_id && subgraph.account_id !== accountId) {
		throw new ForbiddenError("Subgraph belongs to another account");
	}

	return subgraph;
}

/** Extract api_key_id from Hono context, or undefined in DEV_MODE */
export function getApiKeyId(c: Context): string | undefined {
	const apiKey = c.get("apiKey") as { id: string } | undefined;
	return apiKey?.id;
}

/** Extract account_id from Hono context, or undefined in DEV_MODE */
export function getAccountId(c: Context): string | undefined {
	return c.get("accountId") as string | undefined;
}

/** Resolve all active API key IDs for the current request's account. */
export async function resolveKeyIds(c: Context): Promise<string[] | undefined> {
	const accountId = getAccountId(c);
	if (!accountId) return undefined;
	const ids = await getAccountKeyIds(getDb(), accountId);
	// Return undefined if no keys — empty array would produce invalid SQL `IN ()`
	return ids.length > 0 ? ids : undefined;
}

/**
 * Resolve the api_key_id to attribute a write to.
 *
 * If the request was authenticated with an API key (sk-sl_…), returns that
 * key's id directly. If the request was authenticated with a session cookie
 * (ss-sl_…), the caller has an accountId but no apiKey — so we look up the
 * account's oldest active API key and return that. This lets session-scoped
 * chat deploys land on the user's "primary" key without prompting for key
 * selection in the UI.
 *
 * Returns undefined if:
 *   - the request isn't authenticated at all (neither apiKey nor accountId)
 *   - the account has zero active API keys (caller should 403 with NO_API_KEY)
 */
export async function resolveApiKeyIdForWrite(
	c: Context,
): Promise<string | undefined> {
	const direct = getApiKeyId(c);
	if (direct) return direct;

	const accountId = getAccountId(c);
	if (!accountId) return undefined;

	const row = await getDb()
		.selectFrom("api_keys")
		.select("id")
		.where("account_id", "=", accountId)
		.where("status", "=", "active")
		.orderBy("created_at", "asc")
		.limit(1)
		.executeTakeFirst();

	return row?.id;
}
