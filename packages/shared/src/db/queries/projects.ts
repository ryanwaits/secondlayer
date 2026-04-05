import type { Kysely } from "kysely";
import type { Database } from "../types";

export async function getProjectsByAccount(
	db: Kysely<Database>,
	accountId: string,
) {
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
) {
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
) {
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
) {
	return db
		.selectFrom("team_invitations")
		.selectAll()
		.where("project_id", "=", projectId)
		.where("accepted_at", "is", null)
		.orderBy("created_at", "desc")
		.execute();
}
