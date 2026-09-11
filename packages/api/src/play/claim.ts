import type { Database } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";
import { consumeClaimToken } from "./tokens.ts";

export async function transferPlayClaim(
	db: Kysely<Database>,
	opts: { tokenHash: string; destAccountId: string },
): Promise<void> {
	const ghostId = await consumeClaimToken(db, opts.tokenHash);
	if (!ghostId) return;

	if (ghostId === opts.destAccountId) {
		await db
			.updateTable("accounts")
			.set({ ghost: false })
			.where("id", "=", ghostId)
			.execute();
		await db
			.updateTable("subgraphs")
			.set({ expires_at: null })
			.where("account_id", "=", ghostId)
			.execute();
		return;
	}

	await db
		.updateTable("subgraphs")
		.set({ account_id: opts.destAccountId, expires_at: null })
		.where("account_id", "=", ghostId)
		.execute();
	await db
		.updateTable("subscriptions")
		.set({ account_id: opts.destAccountId })
		.where("account_id", "=", ghostId)
		.execute();
	await db
		.updateTable("api_keys")
		.set({ account_id: opts.destAccountId })
		.where("account_id", "=", ghostId)
		.execute();
	await db.deleteFrom("accounts").where("id", "=", ghostId).execute();
}
