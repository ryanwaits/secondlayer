import type { Kysely } from "kysely";
import type { Database, Account } from "../types.ts";

export async function upsertAccount(
  db: Kysely<Database>,
  email: string,
): Promise<Account> {
  return await db
    .insertInto("accounts")
    .values({ email })
    .onConflict((oc) =>
      oc.column("email").doUpdateSet({ email }), // no-op update to return existing
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getAccountById(
  db: Kysely<Database>,
  id: string,
): Promise<Account | null> {
  return (
    (await db
      .selectFrom("accounts")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst()) ?? null
  );
}

export async function createMagicLink(
  db: Kysely<Database>,
  email: string,
  token: string,
  expiresInMs = 15 * 60 * 1000,
): Promise<void> {
  await db
    .insertInto("magic_links")
    .values({
      email,
      token,
      expires_at: new Date(Date.now() + expiresInMs),
    })
    .execute();
}

/**
 * Verify a magic link token. Returns the email if valid, null otherwise.
 * Marks the token as used atomically.
 */
export async function verifyMagicLink(
  db: Kysely<Database>,
  token: string,
): Promise<string | null> {
  const result = await db
    .updateTable("magic_links")
    .set({ used_at: new Date() })
    .where("token", "=", token)
    .where("used_at", "is", null)
    .where("expires_at", ">", new Date())
    .returning("email")
    .executeTakeFirst();

  return result?.email ?? null;
}
