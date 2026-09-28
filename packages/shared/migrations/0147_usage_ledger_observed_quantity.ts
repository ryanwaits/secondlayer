import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// The memory sampler floors `quantity` at `MEMORY_FLOOR_GB` before it ever
// reaches the ledger, so the raw sampled RAM is lost — the credits page's
// delivery-service memory chart needs the actual number, not just what got
// billed. `observed_quantity` holds the unfloored sample for
// `memory.gb_hour` rows; every other unit leaves it NULL.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE usage_ledger ADD COLUMN observed_quantity numeric NULL`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE usage_ledger DROP COLUMN IF EXISTS observed_quantity`.execute(
			db,
		);
	});
}
