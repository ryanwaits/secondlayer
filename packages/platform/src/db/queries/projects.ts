import type { Database, Project, TeamInvitation } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

export async function getProjectsByAccount(
	db: Kysely<Database>,
	accountId: string,
): Promise<Project[]> {
	return db
		.selectFrom("projects")
		.selectAll()
		.where("account_id", "=", accountId)
		.orderBy("created_at", "asc")
		.execute();
}

export async function getProjectBySlug(
	db: Kysely<Database>,
	accountId: string,
	slug: string,
): Promise<Project | undefined> {
	return db
		.selectFrom("projects")
		.selectAll()
		.where("account_id", "=", accountId)
		.where("slug", "=", slug)
		.executeTakeFirst();
}

const DEFAULT_PROJECT_SLUG = "my-project";

/**
 * Every account is single-project. Accounts created before the projects table
 * existed were backfilled by migration 0023; accounts created since get nothing
 * at signup, so we lazily provision the default project on first read. Idempotent
 * and race-safe (unique index on projects(account_id, slug)).
 */
export async function ensureDefaultProject(
	db: Kysely<Database>,
	accountId: string,
): Promise<Project> {
	const existing = await getProjectsByAccount(db, accountId);
	if (existing.length > 0) return existing[0];

	await db
		.insertInto("projects")
		.values({
			name: DEFAULT_PROJECT_SLUG,
			slug: DEFAULT_PROJECT_SLUG,
			account_id: accountId,
			network: "mainnet",
			node_rpc: null,
		})
		.onConflict((oc) => oc.columns(["account_id", "slug"]).doNothing())
		.execute();

	const project = await getProjectBySlug(db, accountId, DEFAULT_PROJECT_SLUG);
	if (!project) throw new Error("Failed to provision default project");

	// Owner membership underpins the (currently hidden) team feature; keep the
	// data model coherent for a future revival. Guard since team_members has no
	// unique (project_id, account_id) constraint to rely on for upsert.
	const owner = await db
		.selectFrom("team_members")
		.select("id")
		.where("project_id", "=", project.id)
		.where("account_id", "=", accountId)
		.executeTakeFirst();
	if (!owner) {
		await db
			.insertInto("team_members")
			.values({ project_id: project.id, account_id: accountId, role: "owner" })
			.execute();
	}

	return project;
}

export async function getTeamMembers(
	db: Kysely<Database>,
	projectId: string,
): Promise<
	Array<{
		id: string;
		role: string;
		created_at: Date;
		account_id: string;
		email: string | null;
		display_name: string | null;
		avatar_url: string | null;
		account_slug: string | null;
	}>
> {
	return db
		.selectFrom("team_members")
		.innerJoin("accounts", "accounts.id", "team_members.account_id")
		.select([
			"team_members.id",
			"team_members.role",
			"team_members.created_at",
			"accounts.id as account_id",
			"accounts.email",
			"accounts.display_name",
			"accounts.avatar_url",
			"accounts.slug as account_slug",
		])
		.where("team_members.project_id", "=", projectId)
		.orderBy("team_members.created_at", "asc")
		.execute();
}

export async function getTeamInvitations(
	db: Kysely<Database>,
	projectId: string,
): Promise<TeamInvitation[]> {
	return db
		.selectFrom("team_invitations")
		.selectAll()
		.where("project_id", "=", projectId)
		.where("accepted_at", "is", null)
		.orderBy("created_at", "desc")
		.execute();
}
