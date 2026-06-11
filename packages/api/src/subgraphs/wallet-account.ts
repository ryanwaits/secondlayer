import type { Database } from "@secondlayer/shared";
import type { Kysely } from "kysely";

/**
 * Wallet-ghost accounts — the identity behind x402-paid deploys.
 *
 * A paid deploy has no API key and no email; its durable identity is the
 * Stacks principal that paid. Each principal maps to exactly one ghost
 * account (`accounts.wallet_principal`, partial unique index), so repeat
 * deploys land under the same owner and the registry/cache/visibility
 * machinery all behave as if it were any other account. Plan stays 'none' →
 * the genesis clamp keeps paid deploys forward-only by construction.
 */
export async function resolveWalletAccount(
	db: Kysely<Database>,
	payerPrincipal: string,
): Promise<{ id: string }> {
	const existing = await db
		.selectFrom("accounts")
		.select("id")
		.where("wallet_principal", "=", payerPrincipal)
		.executeTakeFirst();
	if (existing) return existing;

	// Targetless ON CONFLICT DO NOTHING: the unique index on wallet_principal
	// is partial, so it can't be named as a conflict target — but any unique
	// violation (a concurrent insert for the same principal) is absorbed and
	// resolved by the re-select.
	const inserted = await db
		.insertInto("accounts")
		.values({
			email: null,
			ghost: true,
			wallet_principal: payerPrincipal,
		})
		.onConflict((oc) => oc.doNothing())
		.returning("id")
		.executeTakeFirst();
	if (inserted) return inserted;
	return db
		.selectFrom("accounts")
		.select("id")
		.where("wallet_principal", "=", payerPrincipal)
		.executeTakeFirstOrThrow();
}
