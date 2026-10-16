import { type Kysely, sql } from "kysely";
import { jsonb, parseJsonb } from "../db/jsonb.ts";
import type { Database } from "../db/types.ts";
import type { Insight, InsightSeverity } from "../schemas/insights.ts";
import { rankInsights } from "./rank.ts";
import { CLEAR_STREAK_TO_RESOLVE, RECOVERED_VISIBLE_MS } from "./thresholds.ts";
import type { DetectedInsight, EvaluatedKey, InsightScope } from "./types.ts";

type Payload = Pick<
	Insight,
	| "resource"
	| "line"
	| "meta"
	| "lead"
	| "body"
	| "evidence"
	| "handoff"
	| "how"
>;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SQL predicate scoping a table to one account (or to the NULL tenant scope). */
function scopeWhere(scope: InsightScope, column = sql.ref("account_id")) {
	return scope.accountId === null
		? sql`${column} IS NULL`
		: sql`${column} = ${scope.accountId}`;
}

function toPayload(insight: DetectedInsight): Payload {
	return {
		resource: insight.resource,
		line: insight.line,
		...(insight.meta !== undefined ? { meta: insight.meta } : {}),
		lead: insight.lead,
		body: insight.body,
		evidence: insight.evidence,
		handoff: insight.handoff,
		how: insight.how,
	};
}

/**
 * Persist one evaluation pass.
 *
 * Fired insights upsert on the open (resource, rule) row. Every key in
 * `evaluatedKeys` that has an open row and did not fire gains a clear streak,
 * and resolves once the streak reaches `CLEAR_STREAK_TO_RESOLVE`. A rule that
 * was skipped (missing data) must stay out of `evaluatedKeys` so it never
 * counts toward clearing.
 */
export async function recordEvaluation(
	db: Kysely<Database>,
	scope: InsightScope,
	fired: DetectedInsight[],
	evaluatedKeys: EvaluatedKey[],
	now: Date = new Date(),
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		for (const insight of fired) {
			await sql`
				INSERT INTO insights
					(account_id, resource_kind, resource_id, rule, severity, impact,
					 payload, first_seen_at, last_seen_at)
				VALUES
					(${scope.accountId}, ${insight.resource.kind}, ${insight.resource.id},
					 ${insight.rule}, ${insight.severity}, ${insight.impact},
					 ${jsonb(toPayload(insight))}, ${now}, ${now})
				ON CONFLICT
					(coalesce(account_id, ${sql.lit(NIL_UUID)}::uuid), resource_kind, resource_id, rule)
					WHERE resolved_at IS NULL
				DO UPDATE SET
					payload = EXCLUDED.payload,
					severity = EXCLUDED.severity,
					impact = EXCLUDED.impact,
					last_seen_at = EXCLUDED.last_seen_at,
					clear_streak = 0
			`.execute(trx);
		}

		const firedKeys = new Set(
			fired.map(
				(i) => `${i.resource.kind}\u0000${i.resource.id}\u0000${i.rule}`,
			),
		);
		for (const key of evaluatedKeys) {
			if (firedKeys.has(`${key.kind}\u0000${key.id}\u0000${key.rule}`))
				continue;
			await sql`
				UPDATE insights
				SET clear_streak = clear_streak + 1,
					resolved_at = CASE
						WHEN clear_streak + 1 >= ${CLEAR_STREAK_TO_RESOLVE}
						THEN ${now}::timestamptz
						ELSE NULL
					END
				WHERE ${scopeWhere(scope)}
					AND resource_kind = ${key.kind}
					AND resource_id = ${key.id}
					AND rule = ${key.rule}
					AND resolved_at IS NULL
			`.execute(trx);
		}
	});
}

/** (kind, id) pairs that have an open insight in this scope. */
export async function listOpenResources(
	db: Kysely<Database>,
	scope: InsightScope,
): Promise<{ kind: Insight["resource"]["kind"]; id: string; rule: string }[]> {
	const { rows } = await sql<{
		resource_kind: Insight["resource"]["kind"];
		resource_id: string;
		rule: string;
	}>`
		SELECT resource_kind, resource_id, rule FROM insights
		WHERE ${scopeWhere(scope)} AND resolved_at IS NULL
	`.execute(db);
	return rows.map((r) => ({
		kind: r.resource_kind,
		id: r.resource_id,
		rule: r.rule,
	}));
}

/**
 * Open rows plus rows resolved within `RECOVERED_VISIBLE_MS`, minus dismissed
 * and muted ones. Resolved rows come back as `recovered`. Ranked.
 */
export async function listInsights(
	db: Kysely<Database>,
	scope: InsightScope,
	now: Date = new Date(),
	filter: { kind?: string; id?: string } = {},
): Promise<Insight[]> {
	const since = new Date(now.getTime() - RECOVERED_VISIBLE_MS);
	const { rows } = await sql<{
		id: string;
		rule: string;
		severity: string;
		impact: number;
		payload: unknown;
		first_seen_at: Date;
		resolved_at: Date | null;
	}>`
		SELECT i.id, i.rule, i.severity, i.impact, i.payload, i.first_seen_at, i.resolved_at
		FROM insights i
		WHERE ${scopeWhere(scope, sql.ref("i.account_id"))}
			AND i.dismissed_at IS NULL
			AND (i.resolved_at IS NULL OR i.resolved_at > ${since})
			${filter.kind ? sql`AND i.resource_kind = ${filter.kind}` : sql``}
			${filter.id ? sql`AND i.resource_id = ${filter.id}` : sql``}
			AND NOT EXISTS (
				SELECT 1 FROM insight_mutes m
				WHERE ${scopeWhere(scope, sql.ref("m.account_id"))}
					AND m.resource_kind = i.resource_kind
					AND m.resource_id = i.resource_id
					AND m.rule = i.rule
			)
	`.execute(db);

	return rankInsights(
		rows.map((row) => {
			const payload = parseJsonb<Payload>(row.payload);
			return {
				id: row.id,
				rule: row.rule,
				severity: row.resolved_at
					? "recovered"
					: (row.severity as InsightSeverity),
				impact: Number(row.impact),
				...payload,
				createdAt: row.first_seen_at.toISOString(),
				resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
			} satisfies Insight;
		}),
	);
}

/** Hide the current incident. Returns false when the id is not in scope. */
export async function dismissInsight(
	db: Kysely<Database>,
	scope: InsightScope,
	id: string,
	now: Date = new Date(),
): Promise<boolean> {
	if (!UUID_RE.test(id)) return false;
	const result = await sql`
		UPDATE insights SET dismissed_at = ${now}
		WHERE id = ${id}::uuid AND ${scopeWhere(scope)}
	`.execute(db);
	return Number(result.numAffectedRows ?? 0) > 0;
}

/** Mute the insight's rule for its resource until un-muted. */
export async function muteRule(
	db: Kysely<Database>,
	scope: InsightScope,
	id: string,
): Promise<boolean> {
	if (!UUID_RE.test(id)) return false;
	const result = await sql`
		INSERT INTO insight_mutes (account_id, resource_kind, resource_id, rule)
		SELECT account_id, resource_kind, resource_id, rule FROM insights
		WHERE id = ${id}::uuid AND ${scopeWhere(scope)}
		ON CONFLICT (coalesce(account_id, ${sql.lit(NIL_UUID)}::uuid), resource_kind, resource_id, rule)
		DO NOTHING
	`.execute(db);
	if (Number(result.numAffectedRows ?? 0) > 0) return true;
	// Already muted counts as success; unknown id does not.
	return existsInScope(db, scope, id);
}

export async function unmuteRule(
	db: Kysely<Database>,
	scope: InsightScope,
	id: string,
): Promise<boolean> {
	if (!(await existsInScope(db, scope, id))) return false;
	await sql`
		DELETE FROM insight_mutes m
		USING insights i
		WHERE i.id = ${id}::uuid
			AND ${scopeWhere(scope, sql.ref("i.account_id"))}
			AND ${scopeWhere(scope, sql.ref("m.account_id"))}
			AND m.resource_kind = i.resource_kind
			AND m.resource_id = i.resource_id
			AND m.rule = i.rule
	`.execute(db);
	return true;
}

async function existsInScope(
	db: Kysely<Database>,
	scope: InsightScope,
	id: string,
): Promise<boolean> {
	if (!UUID_RE.test(id)) return false;
	const { rows } = await sql<{ id: string }>`
		SELECT id FROM insights WHERE id = ${id}::uuid AND ${scopeWhere(scope)}
	`.execute(db);
	return rows.length > 0;
}

/** Delete resolved or dismissed-and-resolved rows older than `olderThanDays`. */
export async function purgeResolved(
	db: Kysely<Database>,
	scope: InsightScope,
	olderThanDays = 30,
	now: Date = new Date(),
): Promise<void> {
	const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
	await sql`
		DELETE FROM insights
		WHERE ${scopeWhere(scope)} AND resolved_at IS NOT NULL AND resolved_at < ${cutoff}
	`.execute(db);
}
