import { type Kysely, sql } from "kysely";
import type { Database } from "../db/types.ts";
import { type HealthSnapshotPoint, bucketHourly } from "../subgraphs/health.ts";
import { handoffPrompt, plainSnippet, plural } from "./prompt.ts";
import {
	HANDLER_ERRORS_MIN_24H,
	SUBGRAPH_LAG_BLOCKS,
	SUBGRAPH_LAG_LOSING_BLOCKS,
	SUBGRAPH_LAG_SNAPSHOTS,
} from "./thresholds.ts";
import type { InsightRule } from "./types.ts";

const HOUR_MS = 3_600_000;
const ERROR_GROUPS_SHOWN = 3;

export interface SubgraphErrorGroupInput {
	message: string;
	eventType: string | null;
	sourceName: string;
	/** All-time count for the group (not limited to the last 24 hours). */
	count: number;
	lastSeen: Date;
}

export interface SubgraphRuleInput {
	now: Date;
	subgraph: { id: string; name: string; status: string };
	/** Health snapshots from roughly the last 25 hours. */
	snapshots: HealthSnapshotPoint[];
	/** Groups seen in the last 24 hours, most frequent first. */
	errorGroups: SubgraphErrorGroupInput[];
}

function subject(name: string): string {
	return `My Secondlayer subgraph "${name}"`;
}

function resourceOf(input: SubgraphRuleInput) {
	return {
		kind: "subgraph" as const,
		id: input.subgraph.name,
		name: input.subgraph.name,
	};
}

const handlerErrors: InsightRule<SubgraphRuleInput> = {
	id: "subgraph_handler_errors",
	skip: (input) => input.snapshots.length === 0,
	evaluate(input) {
		const hours = bucketHourly(input.snapshots, 24, input.now.getTime());
		const errors = hours.reduce((sum, h) => sum + h.errors, 0);
		if (errors < HANDLER_ERRORS_MIN_24H) return null;

		const { subgraph } = input;
		const top = input.errorGroups.slice(0, ERROR_GROUPS_SHOWN);
		const leader = top[0];
		const eventTypes = [
			...new Set(top.map((g) => g.eventType).filter((t): t is string => !!t)),
		];
		const leaderText = leader ? plainSnippet(leader.message, 120) : "";

		return {
			rule: "subgraph_handler_errors",
			severity: "losing",
			impact: errors,
			resource: resourceOf(input),
			line: `${subgraph.name} threw ${plural(errors, "handler error")} today`,
			meta: "last 24 hours",
			lead: "Your handler is failing on some events.",
			body: [
				`${plural(errors, "event")} failed inside your handler in the last 24 hours, and those rows were not written.`,
				leader
					? `The most common error is: ${leaderText}${eventTypes.length > 0 ? ` (event type ${eventTypes[0]})` : ""}.`
					: "",
			]
				.filter(Boolean)
				.join(" "),
			evidence:
				top.length > 0
					? [
							{
								kind: "table",
								title: "Most common errors",
								columns: ["Error", "Event type", "Seen"],
								rows: top.map((g) => [
									plainSnippet(g.message, 120),
									g.eventType ?? g.sourceName,
									g.count,
								]),
							},
						]
					: [],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(subgraph.name),
					observed: [
						`threw ${plural(errors, "handler error")} in the last 24 hours`,
						leader
							? `The most common error is: ${leaderText}${eventTypes[0] ? ` on event type ${eventTypes[0]}` : ""}, seen ${plural(leader.count, "time")} in total`
							: "",
					],
					lookAt:
						eventTypes.length > 0
							? `Check how the handler deals with ${eventTypes.join(" and ")} events`
							: "Check what the failing events have in common",
					followUp: `Then run sl subgraphs gaps ${subgraph.name}`,
				}),
				commands: [`sl subgraphs gaps ${subgraph.name}`],
			},
			how: {
				detector: `${HANDLER_ERRORS_MIN_24H} or more handler errors in the last 24 hours of health history`,
				facts: [
					["errors in 24 hours", String(errors)],
					[
						"event types in top errors",
						eventTypes.join(", ") || "none recorded",
					],
					["group counts", "all-time per group, not limited to 24 hours"],
				],
			},
		};
	},
};

const lag: InsightRule<SubgraphRuleInput> = {
	id: "subgraph_lag",
	skip: (input) => lagSamples(input).length < SUBGRAPH_LAG_SNAPSHOTS,
	evaluate(input) {
		if (input.subgraph.status !== "active") return null;
		const newest = lagSamples(input).slice(0, SUBGRAPH_LAG_SNAPSHOTS);
		if (newest.length < SUBGRAPH_LAG_SNAPSHOTS) return null;
		if (!newest.every((s) => s.blocks > SUBGRAPH_LAG_BLOCKS)) return null;

		const current = newest[0]?.blocks ?? 0;
		const since = newest[newest.length - 1]?.at ?? input.now;
		const minutes = Math.max(
			1,
			Math.round((input.now.getTime() - since.getTime()) / 60_000),
		);
		const { subgraph } = input;
		const hours = bucketHourly(input.snapshots, 24, input.now.getTime());

		return {
			rule: "subgraph_lag",
			severity: current > SUBGRAPH_LAG_LOSING_BLOCKS ? "losing" : "will_fail",
			impact: current,
			resource: resourceOf(input),
			line: `${subgraph.name} is ${plural(current, "block")} behind`,
			meta: `for about ${plural(minutes, "minute")}`,
			lead: "Your subgraph is falling behind the chain.",
			body: `It has trailed the chain tip by more than ${SUBGRAPH_LAG_BLOCKS} blocks on its last ${SUBGRAPH_LAG_SNAPSHOTS} checks, and is ${plural(current, "block")} behind now. Rows are late until it catches up.`,
			evidence: [
				{
					kind: "series",
					title: "Blocks behind the chain, per hour",
					series: [
						{
							name: "Blocks behind",
							role: "a",
							points: hours.map((h) => h.lagBlocks ?? 0),
						},
					],
					labels: [
						[0, "24h ago"],
						[hours.length - 1, "now"],
					],
					unit: "blocks",
				},
			],
			handoff: {
				prompt: handoffPrompt({
					subject: subject(subgraph.name),
					observed: [
						`has been more than ${SUBGRAPH_LAG_BLOCKS} blocks behind the chain for about ${plural(minutes, "minute")}`,
						`It is ${plural(current, "block")} behind right now`,
					],
					lookAt:
						"Check whether the handler got slower, a recent deploy changed how much work each block needs, or the subgraph is processing a very large range",
					followUp: `Then run sl subgraphs status ${subgraph.name}`,
				}),
				commands: [`sl subgraphs status ${subgraph.name}`],
			},
			how: {
				detector: `more than ${SUBGRAPH_LAG_BLOCKS} blocks behind the tip on ${SUBGRAPH_LAG_SNAPSHOTS} consecutive health snapshots, and not reindexing`,
				facts: [
					["blocks behind now", String(current)],
					["snapshots over the line", String(newest.length)],
					["behind since about", `${since.toISOString().slice(11, 16)} UTC`],
				],
			},
		};
	},
};

/** Per-snapshot lag, newest first, for snapshots that know both positions. */
function lagSamples(input: SubgraphRuleInput): { at: Date; blocks: number }[] {
	return input.snapshots
		.map((s) => ({
			at: new Date(s.captured_at),
			tip: s.chain_tip === null ? null : Number(s.chain_tip),
			cursor:
				s.last_processed_block === null ? null : Number(s.last_processed_block),
		}))
		.filter(
			(s): s is { at: Date; tip: number; cursor: number } =>
				s.tip !== null && s.cursor !== null,
		)
		.sort((a, b) => b.at.getTime() - a.at.getTime())
		.map((s) => ({ at: s.at, blocks: Math.max(0, s.tip - s.cursor) }));
}

export const SUBGRAPH_RULES: InsightRule<SubgraphRuleInput>[] = [
	handlerErrors,
	lag,
];

/** Health history and error groups for every subgraph, in three queries. */
export async function loadSubgraphInputs(
	db: Kysely<Database>,
	now: Date,
): Promise<SubgraphRuleInput[]> {
	const subgraphs = await db
		.selectFrom("subgraphs")
		.select(["id", "name", "status"])
		.execute();
	if (subgraphs.length === 0) return [];

	const since = new Date(now.getTime() - 25 * HOUR_MS);
	const snapshots = await db
		.selectFrom("subgraph_health_snapshots")
		.select([
			"subgraph_id",
			"captured_at",
			"chain_tip",
			"last_processed_block",
			"rows_written_total",
			"total_errors",
			"total_processed",
		])
		.where("captured_at", ">=", since)
		.orderBy("captured_at", "asc")
		.execute();

	const groups = await sql<{
		subgraph_name: string;
		message: string;
		event_type: string | null;
		source_name: string;
		count: string | number;
		last_seen: Date;
	}>`
		SELECT subgraph_name, message, event_type, source_name, count, last_seen
		FROM subgraph_error_groups
		WHERE last_seen > ${new Date(now.getTime() - 24 * HOUR_MS)}
		ORDER BY count DESC
	`.execute(db);

	return subgraphs.map((subgraph) => ({
		now,
		subgraph,
		snapshots: snapshots.filter((s) => s.subgraph_id === subgraph.id),
		errorGroups: groups.rows
			.filter((g) => g.subgraph_name === subgraph.name)
			.slice(0, ERROR_GROUPS_SHOWN)
			.map((g) => ({
				message: g.message,
				eventType: g.event_type,
				sourceName: g.source_name,
				count: Number(g.count),
				lastSeen: g.last_seen,
			})),
	}));
}
