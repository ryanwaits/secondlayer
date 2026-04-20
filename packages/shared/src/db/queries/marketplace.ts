import { type Kysely, sql } from "kysely";
import type { Database, Subgraph } from "../types.ts";

/**
 * List public subgraphs with creator info and usage stats.
 */
export async function listPublicSubgraphs(
	db: Kysely<Database>,
	opts: {
		limit?: number;
		offset?: number;
		tags?: string[];
		search?: string;
		sort?: "recent" | "popular" | "name";
	} = {},
): Promise<{
	data: any[];
	meta: { total: number; limit: number; offset: number };
}> {
	const limit = Math.min(Math.max(1, opts.limit ?? 50), 100);
	const offset = Math.max(0, opts.offset ?? 0);

	let query = db
		.selectFrom("subgraphs")
		.innerJoin("accounts", "accounts.id", "subgraphs.account_id")
		.select([
			"subgraphs.id",
			"subgraphs.name",
			"subgraphs.description",
			"subgraphs.tags",
			"subgraphs.status",
			"subgraphs.version",
			"subgraphs.definition",
			"subgraphs.last_processed_block",
			"subgraphs.start_block",
			"subgraphs.total_processed",
			"subgraphs.created_at",
			"subgraphs.forked_from_id",
			"accounts.display_name",
			"accounts.slug",
			sql<number>`(SELECT COALESCE(SUM(query_count), 0) FROM subgraph_usage_daily WHERE subgraph_id = subgraphs.id AND date >= CURRENT_DATE - 7)::int`.as(
				"queries_7d",
			),
			sql<number>`(SELECT COUNT(*) FROM subgraphs s2 WHERE s2.forked_from_id = subgraphs.id)::int`.as(
				"fork_count",
			),
		])
		.where("subgraphs.is_public", "=", true);

	// Filter by tags (AND — all must match)
	if (opts.tags && opts.tags.length > 0) {
		query = query.where(
			sql<boolean>`subgraphs.tags @> ${sql.val(opts.tags)}::text[]`,
		);
	}

	// Search by name or description
	if (opts.search) {
		const term = `%${opts.search}%`;
		query = query.where((eb) =>
			eb.or([
				eb("subgraphs.name", "ilike", term),
				eb("subgraphs.description", "ilike", term),
			]),
		);
	}

	// Sort
	if (opts.sort === "popular") {
		query = query.orderBy(sql`queries_7d`, "desc");
	} else if (opts.sort === "name") {
		query = query.orderBy("subgraphs.name", "asc");
	} else {
		// Default: recent
		query = query.orderBy("subgraphs.created_at", "desc");
	}

	// Count
	let countQuery = db
		.selectFrom("subgraphs")
		.select(sql<number>`count(*)::int`.as("count"))
		.where("is_public", "=", true);

	if (opts.tags && opts.tags.length > 0) {
		countQuery = countQuery.where(
			sql<boolean>`tags @> ${sql.val(opts.tags)}::text[]`,
		);
	}
	if (opts.search) {
		const term = `%${opts.search}%`;
		countQuery = countQuery.where((eb) =>
			eb.or([eb("name", "ilike", term), eb("description", "ilike", term)]),
		);
	}

	const [rows, countRow] = await Promise.all([
		query.limit(limit).offset(offset).execute(),
		countQuery.executeTakeFirst(),
	]);

	return {
		data: rows,
		meta: { total: countRow?.count ?? 0, limit, offset },
	};
}

/**
 * Get a single public subgraph by name with creator info.
 */
export async function getPublicSubgraph(
	db: Kysely<Database>,
	name: string,
): Promise<any | undefined> {
	return db
		.selectFrom("subgraphs")
		.innerJoin("accounts", "accounts.id", "subgraphs.account_id")
		.selectAll("subgraphs")
		.select(["accounts.display_name", "accounts.slug"])
		.where("subgraphs.name", "=", name)
		.where("subgraphs.is_public", "=", true)
		.executeTakeFirst();
}

/**
 * Get a creator profile by slug with their public subgraphs.
 */
export async function getCreatorProfile(
	db: Kysely<Database>,
	slug: string,
): Promise<{ account: any; subgraphs: any[] } | null> {
	const account = await db
		.selectFrom("accounts")
		.select(["id", "display_name", "bio", "avatar_url", "slug"])
		.where("slug", "=", slug)
		.executeTakeFirst();

	if (!account) return null;

	const subgraphs = await db
		.selectFrom("subgraphs")
		.select([
			"subgraphs.id",
			"subgraphs.name",
			"subgraphs.description",
			"subgraphs.tags",
			"subgraphs.status",
			"subgraphs.version",
			"subgraphs.definition",
			"subgraphs.last_processed_block",
			"subgraphs.start_block",
			"subgraphs.total_processed",
			"subgraphs.created_at",
			sql<number>`(SELECT COALESCE(SUM(query_count), 0) FROM subgraph_usage_daily WHERE subgraph_id = subgraphs.id AND date >= CURRENT_DATE - 7)::int`.as(
				"queries_7d",
			),
		])
		.where("subgraphs.account_id", "=", account.id)
		.where("subgraphs.is_public", "=", true)
		.orderBy("subgraphs.created_at", "desc")
		.execute();

	return { account, subgraphs };
}

/**
 * Publish a subgraph (set is_public = true).
 */
export async function publishSubgraph(
	db: Kysely<Database>,
	subgraphId: string,
	opts?: { tags?: string[]; description?: string },
): Promise<Subgraph> {
	const set: Record<string, unknown> = {
		is_public: true,
		updated_at: new Date(),
	};
	if (opts?.tags) set.tags = sql`${sql.val(opts.tags)}::text[]`;
	if (opts?.description !== undefined) set.description = opts.description;

	return db
		.updateTable("subgraphs")
		.set(set)
		.where("id", "=", subgraphId)
		.returningAll()
		.executeTakeFirstOrThrow();
}

/**
 * Unpublish a subgraph (set is_public = false).
 */
export async function unpublishSubgraph(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<Subgraph> {
	return db
		.updateTable("subgraphs")
		.set({ is_public: false, updated_at: new Date() })
		.where("id", "=", subgraphId)
		.returningAll()
		.executeTakeFirstOrThrow();
}

/**
 * Increment per-subgraph query count for today. Fire-and-forget safe.
 */
export async function incrementSubgraphQueryCount(
	db: Kysely<Database>,
	subgraphId: string,
): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	await sql`
		INSERT INTO subgraph_usage_daily (subgraph_id, date, query_count)
		VALUES (${subgraphId}, ${today}, 1)
		ON CONFLICT (subgraph_id, date)
		DO UPDATE SET query_count = subgraph_usage_daily.query_count + 1
	`.execute(db);
}

/**
 * Get daily usage history for a subgraph.
 */
export async function getSubgraphUsageHistory(
	db: Kysely<Database>,
	subgraphId: string,
	days: number,
): Promise<Array<{ date: string; query_count: number }>> {
	return db
		.selectFrom("subgraph_usage_daily")
		.select(["date", "query_count"])
		.where("subgraph_id", "=", subgraphId)
		.where("date", ">=", sql<string>`CURRENT_DATE - ${days}::int`)
		.orderBy("date", "asc")
		.execute();
}

/**
 * Get total query count for a subgraph over last N days.
 */
export async function getSubgraphQueryTotal(
	db: Kysely<Database>,
	subgraphId: string,
	days: number,
): Promise<number> {
	const row = await db
		.selectFrom("subgraph_usage_daily")
		.select(sql<number>`COALESCE(SUM(query_count), 0)::int`.as("total"))
		.where("subgraph_id", "=", subgraphId)
		.where("date", ">=", sql<string>`CURRENT_DATE - ${days}::int`)
		.executeTakeFirst();
	return row?.total ?? 0;
}
