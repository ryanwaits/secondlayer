#!/usr/bin/env bun
/**
 * Feedback queue — read-only listing of hosted feedback tickets by route, and
 * the labelling export that feeds classifier-compare.
 *
 * Usage:
 *   bun scripts/ops/feedback-queue.ts [--route <r>] [--status new|classified]
 *     [--since <days>] [--limit <n>] [--json | --jsonl] [--internal]
 *
 *   Real accounts only by default, so test tickets never reach the label gate.
 *   --internal lists first-party accounts (dogfood, Sentinel) instead, which
 *   gives classifier-compare a separate test set.
 *
 *   default  plain table grouped by route (low_priority included)
 *   --json   array of rows
 *   --jsonl  one line per ticket: {"id","state","labels":{}} where state is
 *            exactly what the classifier sees. A human adds
 *            "kind": "<FeedbackKind>" to labels; then
 *            bun scripts/ops/classifier-compare.ts \
 *              --questions packages/worker/src/jobs/feedback-classify-core.ts#FEEDBACK_QUESTIONS \
 *              --input feedback-label.jsonl --providers jev,kev,clef
 *
 * Env: TARGET_DATABASE_URL or DATABASE_URL (required).
 * Exit codes: 0 ok, 2 bad usage or no database url.
 * SELECT only; never writes.
 */

import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import {
	type FeedbackTicketInput,
	ROUTES,
	buildFeedbackState,
} from "../../packages/worker/src/jobs/feedback-classify-core.ts";

export type Args = {
	route: string | null;
	status: "new" | "classified" | null;
	since_days: number;
	limit: number;
	format: "table" | "json" | "jsonl";
	internal: boolean;
};

export function parseArgs(argv: string[]): Args {
	const args: Args = {
		route: null,
		status: null,
		since_days: 7,
		limit: 50,
		format: "table",
		internal: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined) throw new Error(`${flag} needs a value`);
			return v;
		};
		switch (flag) {
			case "--route": {
				const v = value();
				if (!(ROUTES as readonly string[]).includes(v)) {
					throw new Error(`--route expects one of ${ROUTES.join("|")}`);
				}
				args.route = v;
				break;
			}
			case "--status": {
				const v = value();
				if (v !== "new" && v !== "classified") {
					throw new Error("--status expects new|classified");
				}
				args.status = v;
				break;
			}
			case "--since":
				args.since_days = positiveInt(flag, value());
				break;
			case "--limit":
				args.limit = positiveInt(flag, value());
				break;
			case "--json":
				args.format = "json";
				break;
			case "--jsonl":
				args.format = "jsonl";
				break;
			case "--internal":
				args.internal = true;
				break;
			default:
				throw new Error(`unknown flag: ${flag}`);
		}
	}
	return args;
}

function positiveInt(flag: string, v: string): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) {
		throw new Error(`${flag} expects a positive integer, got: ${v}`);
	}
	return n;
}

export type TicketRow = {
	id: string;
	intent: string;
	expected: Record<string, unknown> | null;
	kind_hint: string | null;
	evidence: FeedbackTicketInput["evidence"];
	attempted: FeedbackTicketInput["attempted"];
	origin: string | null;
	status: string;
	route: string | null;
	classification: { kind?: string | null; reason?: string | null } | null;
	created_at: Date | string;
};

function toTicket(r: TicketRow): FeedbackTicketInput {
	return {
		id: r.id,
		intent: r.intent,
		expected: r.expected,
		kind_hint: r.kind_hint,
		evidence: r.evidence,
		attempted: r.attempted,
		origin: r.origin,
	};
}

/** One labelling-set line; labels start empty for a human to fill. */
export function formatJsonl(r: TicketRow): string {
	return JSON.stringify({
		id: r.id,
		state: buildFeedbackState(toTicket(r)),
		labels: {},
	});
}

export function formatTableRow(r: TicketRow): string {
	const at =
		r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
	const call = [r.attempted?.path, r.attempted?.code].filter(Boolean).join(" ");
	return [
		at,
		r.route ?? "-",
		r.classification?.kind ?? "-",
		r.classification?.reason ?? "-",
		call || "-",
		r.intent.replace(/\s+/g, " ").slice(0, 60),
	].join(" | ");
}

export function formatTable(rows: TicketRow[]): string {
	if (rows.length === 0) return "no tickets";
	const groups = new Map<string, TicketRow[]>();
	for (const r of rows) {
		const key = r.route ?? "(unrouted)";
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	const out = ["created_at | route | kind | reason | path code | intent"];
	for (const [key, list] of groups) {
		out.push("", `== ${key} (${list.length})`);
		for (const r of list) out.push(formatTableRow(r));
	}
	return out.join("\n");
}

async function main() {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(2);
	}
	const url = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
	if (!url) {
		console.error("no db: set TARGET_DATABASE_URL or DATABASE_URL");
		process.exit(2);
	}
	const client = postgres(url, { max: 1 });
	try {
		const db = new Kysely<Record<string, never>>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		const rows = await sql<TicketRow>`
			SELECT t.id, t.intent, t.expected, t.kind_hint, t.evidence, t.attempted,
			       t.origin, t.status, t.route, t.classification, t.created_at
			FROM feedback_tickets t
			JOIN accounts a ON a.id = t.account_id
			WHERE t.created_at > now() - make_interval(days => ${args.since_days})
			  AND a.internal = ${args.internal}
			  ${args.status ? sql`AND t.status = ${args.status}` : sql``}
			  ${args.route ? sql`AND t.route = ${args.route}` : sql``}
			ORDER BY t.created_at DESC
			LIMIT ${args.limit}
		`.execute(db);
		if (args.format === "json") {
			console.log(JSON.stringify(rows.rows, null, 2));
		} else if (args.format === "jsonl") {
			for (const r of rows.rows) console.log(formatJsonl(r));
		} else {
			console.log(formatTable(rows.rows));
		}
	} finally {
		await client.end();
	}
}

if (import.meta.main) await main();
