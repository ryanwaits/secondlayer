import type { Database } from "@secondlayer/shared/db";
import { type Kysely, sql } from "kysely";

export const PLAY_MAX_CONCURRENT_PER_IP = 3;

/** Distinct unclaimed, unexpired play subgraphs whose mint key is from `ip`. */
export async function countConcurrentPlaySubgraphs(
	db: Kysely<Database>,
	ip: string,
): Promise<number> {
	const row = await db
		.selectFrom("subgraphs")
		.innerJoin("accounts", (join) =>
			// subgraphs.account_id is text; accounts.id is uuid.
			join.on(sql`accounts.id::text = subgraphs.account_id`),
		)
		.innerJoin("api_keys", "api_keys.account_id", "accounts.id")
		.select((eb) => eb.fn.count<string>("subgraphs.id").distinct().as("n"))
		.where("api_keys.ip_address", "=", ip)
		.where("accounts.ghost", "=", true)
		.where("subgraphs.expires_at", "is not", null)
		.where("subgraphs.expires_at", ">", new Date())
		.executeTakeFirst();
	return Number(row?.n ?? 0);
}
