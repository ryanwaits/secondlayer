import { type Kysely, sql } from "kysely";
import { onControlPlane } from "../src/db/migration-role.ts";

// `memory.gb_hour` and `storage.gb_day` are fractional (0.37 GB-hours), but
// `usage_ledger.quantity` was `bigint`, so every workload-host memory/storage
// flush 500'd and those meters never billed. `numeric` holds both the
// integer units (rows, partitions, events) and the fractional ones exactly.
export async function up(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`SET lock_timeout = '30s'`.execute(db);
		await sql`ALTER TABLE usage_ledger ALTER COLUMN quantity TYPE numeric`.execute(
			db,
		);
	});
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await onControlPlane(async () => {
		await sql`ALTER TABLE usage_ledger ALTER COLUMN quantity TYPE bigint USING round(quantity)`.execute(
			db,
		);
	});
}
