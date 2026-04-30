import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE OR REPLACE FUNCTION enforce_tenant_project_account_match()
		RETURNS trigger AS $$
		DECLARE
			project_account uuid;
		BEGIN
			IF NEW.project_id IS NULL THEN
				RETURN NEW;
			END IF;

			SELECT account_id INTO project_account
			FROM projects
			WHERE id = NEW.project_id;

			IF project_account IS NULL THEN
				RETURN NEW;
			END IF;

			IF NEW.account_id IS DISTINCT FROM project_account THEN
				RAISE EXCEPTION 'tenant account_id must match linked project account_id'
					USING ERRCODE = '23514';
			END IF;

			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql
	`.execute(db);

	await sql`
		DROP TRIGGER IF EXISTS tenants_project_account_match ON tenants
	`.execute(db);
	await sql`
		CREATE TRIGGER tenants_project_account_match
			BEFORE INSERT OR UPDATE OF account_id, project_id ON tenants
			FOR EACH ROW
			EXECUTE FUNCTION enforce_tenant_project_account_match()
	`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		DROP TRIGGER IF EXISTS tenants_project_account_match ON tenants
	`.execute(db);
	await sql`
		DROP FUNCTION IF EXISTS enforce_tenant_project_account_match()
	`.execute(db);
}
