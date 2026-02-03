import type { Kysely } from "kysely";
import type { Database } from "@secondlayer/shared/db";
import { StreamNotFoundError } from "@secondlayer/shared";

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

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

  if (accountKeyIds && stream.api_key_id && !accountKeyIds.includes(stream.api_key_id)) {
    throw new ForbiddenError("Stream belongs to another account");
  }

  return stream;
}

/**
 * Assert the authenticated account owns the given view.
 * Returns the view row on success.
 * Throws 404 if not found, 403 if owned by another account.
 */
export async function assertViewOwnership(
  db: Kysely<Database>,
  viewName: string,
  accountKeyIds: string[] | undefined,
) {
  const view = await db
    .selectFrom("views")
    .selectAll()
    .where("name", "=", viewName)
    .executeTakeFirst();

  if (!view) return null;

  if (accountKeyIds && view.api_key_id && !accountKeyIds.includes(view.api_key_id)) {
    throw new ForbiddenError("View belongs to another account");
  }

  return view;
}

/** Extract api_key_id from Hono context, or undefined in DEV_MODE */
export function getApiKeyId(c: any): string | undefined {
  const apiKey = c.get("apiKey");
  return apiKey?.id;
}

/** Extract account_id from Hono context, or undefined in DEV_MODE */
export function getAccountId(c: any): string | undefined {
  return c.get("accountId") as string | undefined;
}
