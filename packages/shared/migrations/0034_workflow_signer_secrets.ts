import { type Kysely, sql } from "kysely";

/**
 * Workflow signer secrets — HMAC shared secrets used by the runner to
 * authenticate requests to customer-hosted remote signer endpoints.
 *
 * Stored per-account, keyed by a user-chosen name referenced via
 * `signer.remote({ hmacRef: "<name>" })` in workflow source. The
 * `encrypted_value` column holds the secret encrypted at rest (runner
 * KMS-decrypts on read). This separation lets customers rotate secrets
 * without redeploying every workflow that references them.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("workflow_signer_secrets")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("account_id", "uuid", (c) =>
			c.notNull().references("accounts.id").onDelete("cascade"),
		)
		.addColumn("name", "text", (c) => c.notNull())
		.addColumn("encrypted_value", "bytea", (c) => c.notNull())
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE UNIQUE INDEX workflow_signer_secrets_account_name_idx ON workflow_signer_secrets (account_id, name)`.execute(
		db,
	);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS workflow_signer_secrets_account_name_idx`.execute(
		db,
	);
	await db.schema.dropTable("workflow_signer_secrets").execute();
}
