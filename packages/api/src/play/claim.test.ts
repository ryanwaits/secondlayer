import { afterAll, describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { hashToken } from "../auth/keys.ts";
import { transferPlayClaim } from "./claim.ts";
import { createClaimToken } from "./tokens.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const db = HAS_DB ? getDb() : (null as never);
const seededAccountIds: string[] = [];
const seededNames: string[] = [];

afterAll(async () => {
	if (!HAS_DB) return;
	if (seededNames.length > 0) {
		await db.deleteFrom("subgraphs").where("name", "in", seededNames).execute();
	}
	if (seededAccountIds.length > 0) {
		await db
			.deleteFrom("api_keys")
			.where("account_id", "in", seededAccountIds)
			.execute();
		await db
			.deleteFrom("claim_tokens")
			.where("account_id", "in", seededAccountIds)
			.execute();
		await db
			.deleteFrom("accounts")
			.where("id", "in", seededAccountIds)
			.execute();
	}
});

describe.skipIf(!HAS_DB)("transferPlayClaim", () => {
	test("moves subgraph and key, clears expiry, deletes ghost; second call no-ops", async () => {
		const ghost = await db
			.insertInto("accounts")
			.values({ email: null, ghost: true })
			.returning("id")
			.executeTakeFirstOrThrow();
		const dest = await db
			.insertInto("accounts")
			.values({
				email: `claim-dest-${crypto.randomUUID().slice(0, 8)}@test.invalid`,
				ghost: false,
			})
			.returning("id")
			.executeTakeFirstOrThrow();
		seededAccountIds.push(ghost.id, dest.id);

		const name = `play-claim-${crypto.randomUUID().slice(0, 8)}`;
		seededNames.push(name);
		await db
			.insertInto("subgraphs")
			.values({
				name,
				status: "active",
				definition: {},
				schema_hash: "test",
				handler_path: "test",
				schema_name: `subgraph_play_claim_${crypto.randomUUID().slice(0, 8)}`,
				account_id: ghost.id,
				last_processed_block: 0,
				database_url_enc: null,
				expires_at: new Date(Date.now() + 86_400_000),
			})
			.execute();
		const playRaw = `sk-sl_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;
		await db
			.insertInto("api_keys")
			.values({
				key_hash: hashToken(playRaw),
				key_prefix: "sk-sl_play",
				account_id: ghost.id,
				ip_address: "test",
				product: "account",
				tier: "free",
				status: "active",
				name: "play",
			})
			.execute();
		const claim = await createClaimToken(db, ghost.id);
		const tokenHash = hashToken(claim.raw);

		await transferPlayClaim(db, { tokenHash, destAccountId: dest.id });

		const sg = await db
			.selectFrom("subgraphs")
			.select(["account_id", "expires_at", "schema_name"])
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(sg.account_id).toBe(dest.id);
		expect(sg.expires_at).toBeNull();
		expect(sg.schema_name).toContain("subgraph_");

		const key = await db
			.selectFrom("api_keys")
			.select("account_id")
			.where("key_hash", "=", hashToken(playRaw))
			.executeTakeFirstOrThrow();
		expect(key.account_id).toBe(dest.id);

		const ghostRow = await db
			.selectFrom("accounts")
			.select("id")
			.where("id", "=", ghost.id)
			.executeTakeFirst();
		expect(ghostRow).toBeUndefined();

		await transferPlayClaim(db, { tokenHash, destAccountId: dest.id });
		const sgAgain = await db
			.selectFrom("subgraphs")
			.select("account_id")
			.where("name", "=", name)
			.executeTakeFirstOrThrow();
		expect(sgAgain.account_id).toBe(dest.id);
	});
});
