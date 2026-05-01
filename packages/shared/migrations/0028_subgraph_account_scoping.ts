import { type Kysely, sql } from "kysely";

/**
 * Account-wide subgraph scoping.
 *
 * Changes:
 * - Add `account_id` column to `subgraphs`, backfilled from `api_keys.account_id`
 * - Swap unique index from (name, api_key_id) → (name, account_id)
 * - Make api_key_id FK nullable (ON DELETE SET NULL) for audit trail
 * - Rename existing PG schemas from key-prefix to account-prefix
 * - Update schema_name column to match
 *
 * After this migration, any API key on the same account can deploy/update
 * the same named subgraph without creating duplicates.
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// 1. Add account_id column (nullable first so we can backfill)
	await db.schema
		.alterTable("subgraphs")
		.addColumn("account_id", "text")
		.execute();

	// 2. Backfill account_id from api_keys
	await sql`
		UPDATE subgraphs s
		SET account_id = k.account_id
		FROM api_keys k
		WHERE k.id = s.api_key_id
	`.execute(db);

	// 3. Set NOT NULL after backfill (default '' for any orphaned rows)
	await sql`
		UPDATE subgraphs SET account_id = '' WHERE account_id IS NULL
	`.execute(db);

	await db.schema
		.alterTable("subgraphs")
		.alterColumn("account_id", (c) => c.setNotNull())
		.execute();

	// 4. Drop old unique index on (name, api_key_id)
	await db.schema
		.dropIndex("subgraphs_name_api_key_id_unique")
		.ifExists()
		.execute();

	// 5. Create new unique index on (name, account_id)
	await db.schema
		.createIndex("subgraphs_name_account_id_unique")
		.unique()
		.on("subgraphs")
		.columns(["name", "account_id"])
		.execute();

	// 6. Add index on account_id for fast lookups
	await db.schema
		.createIndex("subgraphs_account_id_idx")
		.on("subgraphs")
		.column("account_id")
		.execute();

	// 7. Make api_key_id nullable (keep for audit, but allow key deletion)
	await db.schema
		.alterTable("subgraphs")
		.alterColumn("api_key_id", (c) => c.dropNotNull())
		.execute();

	// 8. Rename existing PG schemas from key-prefix to account-prefix
	//    and update schema_name column accordingly.
	//    New format: subgraph_{first8charsOfAccountId}_{name}
	const rows = await sql<{
		id: string;
		name: string;
		schema_name: string | null;
		account_id: string;
	}>`
		SELECT id, name, schema_name, account_id FROM subgraphs
		WHERE schema_name IS NOT NULL
	`.execute(db);

	for (const row of rows.rows) {
		// biome-ignore lint/style/noNonNullAssertion: value is non-null after preceding check or by construction; TS narrowing limitation
		const oldSchema = row.schema_name!;
		const accountPrefix = row.account_id.slice(0, 8).replace(/-/g, "_");
		const safeName = row.name.replace(/-/g, "_");
		const newSchema = `subgraph_${accountPrefix}_${safeName}`;

		if (oldSchema === newSchema) continue;

		// Check if old schema exists before renaming
		const exists = await sql<{ exists: boolean }>`
			SELECT EXISTS(
				SELECT 1 FROM information_schema.schemata
				WHERE schema_name = ${oldSchema}
			) AS exists
		`.execute(db);

		if (exists.rows[0]?.exists) {
			await sql`ALTER SCHEMA ${sql.raw(`"${oldSchema}"`)} RENAME TO ${sql.raw(`"${newSchema}"`)}`.execute(
				db,
			);
		}

		// Update schema_name column regardless of whether schema existed
		await sql`
			UPDATE subgraphs SET schema_name = ${newSchema} WHERE id = ${row.id}
		`.execute(db);
	}
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropIndex("subgraphs_account_id_idx").ifExists().execute();
	await db.schema
		.dropIndex("subgraphs_name_account_id_unique")
		.ifExists()
		.execute();
	await db.schema.alterTable("subgraphs").dropColumn("account_id").execute();
	// Note: unique index on (name, api_key_id) is not restored — use a subsequent migration if needed
}
