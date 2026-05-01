import { type Kysely, sql } from "kysely";

/**
 * Add projects, team_members, and team_invitations tables.
 * Add project_id to streams and subgraphs.
 * Backfill: create a default project per account and assign existing resources.
 */
// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function up(db: Kysely<any>): Promise<void> {
	// Projects table
	await db.schema
		.createTable("projects")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("name", "text", (c) => c.notNull())
		.addColumn("slug", "text", (c) => c.notNull())
		.addColumn("account_id", "uuid", (c) =>
			c.notNull().references("accounts.id").onDelete("cascade"),
		)
		.addColumn("settings", "jsonb", (c) => c.notNull().defaultTo(sql`'{}'`))
		.addColumn("network", "varchar(20)", (c) =>
			c.notNull().defaultTo("mainnet"),
		)
		.addColumn("node_rpc", "text")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.addColumn("updated_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	// Unique slug per account
	await sql`CREATE UNIQUE INDEX projects_account_slug_idx ON projects (account_id, slug)`.execute(
		db,
	);

	// Team members table
	await db.schema
		.createTable("team_members")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("project_id", "uuid", (c) =>
			c.notNull().references("projects.id").onDelete("cascade"),
		)
		.addColumn("account_id", "uuid", (c) =>
			c.notNull().references("accounts.id").onDelete("cascade"),
		)
		.addColumn("role", "varchar(20)", (c) => c.notNull().defaultTo("member"))
		.addColumn("invited_by", "uuid", (c) =>
			c.references("accounts.id").onDelete("set null"),
		)
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	await sql`CREATE UNIQUE INDEX team_members_project_account_idx ON team_members (project_id, account_id)`.execute(
		db,
	);

	// Team invitations table
	await db.schema
		.createTable("team_invitations")
		.addColumn("id", "uuid", (c) =>
			c.primaryKey().defaultTo(sql`gen_random_uuid()`),
		)
		.addColumn("project_id", "uuid", (c) =>
			c.notNull().references("projects.id").onDelete("cascade"),
		)
		.addColumn("email", "text", (c) => c.notNull())
		.addColumn("role", "varchar(20)", (c) => c.notNull().defaultTo("member"))
		.addColumn("token", "varchar(64)", (c) => c.notNull())
		.addColumn("invited_by", "uuid", (c) =>
			c.references("accounts.id").onDelete("set null"),
		)
		.addColumn("expires_at", "timestamptz", (c) => c.notNull())
		.addColumn("accepted_at", "timestamptz")
		.addColumn("created_at", "timestamptz", (c) =>
			c.notNull().defaultTo(sql`now()`),
		)
		.execute();

	// Add project_id to streams and subgraphs
	await db.schema
		.alterTable("streams")
		.addColumn("project_id", "uuid", (c) =>
			c.references("projects.id").onDelete("set null"),
		)
		.execute();

	await db.schema
		.alterTable("subgraphs")
		.addColumn("project_id", "uuid", (c) =>
			c.references("projects.id").onDelete("set null"),
		)
		.execute();

	// Backfill: create default project per account, assign resources
	await sql`
		INSERT INTO projects (id, name, slug, account_id)
		SELECT gen_random_uuid(), 'my-project', 'my-project', id
		FROM accounts
	`.execute(db);

	await sql`
		UPDATE streams SET project_id = p.id
		FROM api_keys ak
		JOIN projects p ON p.account_id = ak.account_id
		WHERE streams.api_key_id = ak.id AND streams.project_id IS NULL
	`.execute(db);

	await sql`
		UPDATE subgraphs SET project_id = p.id
		FROM api_keys ak
		JOIN projects p ON p.account_id = ak.account_id
		WHERE subgraphs.api_key_id = ak.id AND subgraphs.project_id IS NULL
	`.execute(db);

	// Add owner team_member for each project
	await sql`
		INSERT INTO team_members (id, project_id, account_id, role)
		SELECT gen_random_uuid(), id, account_id, 'owner'
		FROM projects
	`.execute(db);

	// Indexes
	await sql`CREATE INDEX streams_project_id_idx ON streams (project_id) WHERE project_id IS NOT NULL`.execute(
		db,
	);
	await sql`CREATE INDEX subgraphs_project_id_idx ON subgraphs (project_id) WHERE project_id IS NOT NULL`.execute(
		db,
	);
}

// biome-ignore lint/suspicious/noExplicitAny: interop boundary or dynamic-shape value where typing adds friction without runtime safety
export async function down(db: Kysely<any>): Promise<void> {
	await sql`DROP INDEX IF EXISTS subgraphs_project_id_idx`.execute(db);
	await sql`DROP INDEX IF EXISTS streams_project_id_idx`.execute(db);

	await db.schema.alterTable("subgraphs").dropColumn("project_id").execute();
	await db.schema.alterTable("streams").dropColumn("project_id").execute();

	await db.schema.dropTable("team_invitations").execute();
	await db.schema.dropTable("team_members").execute();

	await sql`DROP INDEX IF EXISTS projects_account_slug_idx`.execute(db);
	await db.schema.dropTable("projects").execute();
}
