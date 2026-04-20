import type { Kysely } from "kysely";
import type { Database, Project, TeamInvitation } from "../types.ts";

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

export async function getTeamMembers(
	db: Kysely<Database>,
	projectId: string,
): Promise<
	Array<{
		id: string;
		role: string;
		created_at: Date;
		account_id: string;
		email: string;
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
