#!/usr/bin/env bun
/**
 * Jev fault-triage spike — evaluate TypeSafe's Jev (via Vercel AI Gateway) as a
 * triage layer over decoder stage failures, against the heuristics we ship
 * today.
 *
 * Today two mechanisms classify decoder faults:
 *
 *   1. producers record a `class` on `stage_failures` (omission, version,
 *      digest_mismatch, crash, reorg, source_gap, handler, timeout, unknown)
 *   2. `classifyGenericDecodeFault` (packages/indexer/src/decode/generic-commit.ts)
 *      regexes an error string into omission|version for the generic decoder
 *
 * Both are write-path decisions made by code that was there at the failure.
 * This script asks a different question: given only what an operator would see
 * (stage id, error text, block range, retry count), can Jev reproduce those
 * classes, and does its severity/transience read look useful for alerting?
 *
 * The recorded class is deliberately EXCLUDED from the state sent to Jev —
 * including it would leak the label we are trying to reproduce.
 *
 * Design: the core is PURE (buildTriageState, triageQuestions, verdictFor,
 * summarize). IO — postgres, the AI Gateway call, the dynamic import of the
 * indexer regex — lives in main() only, so the comparison logic is unit
 * testable with no database and no network. Run the test with:
 *
 *   bun test scripts/ops/jev-fault-triage.test.ts
 *
 * Usage:
 *   bun scripts/ops/jev-fault-triage.ts --since 30d --limit 25
 *   bun scripts/ops/jev-fault-triage.ts --input failures.jsonl --json
 *
 * Input mode replays prod failures without prod access:
 *   psql "$PROD_SOURCE_URL" -c "COPY (SELECT row_to_json(t) FROM (
 *     SELECT stage_id, class, retry_state, retry_count, last_error,
 *            from_height, to_height, created_at
 *     FROM stage_failures ORDER BY created_at DESC LIMIT 200) t
 *   ) TO STDOUT" > failures.jsonl
 *
 * Exit codes: 0 ran and produced a summary, 2 inconclusive (missing
 * AI_GATEWAY_API_KEY, no db, or no rows to evaluate).
 *
 * Env: AI_GATEWAY_API_KEY (required, .env.local is auto-loaded from repo
 * root). SOURCE_DATABASE_URL or DATABASE_URL (required unless --input).
 * Cost: ~300-600 input tokens per failure at $0.042/M — a 25-row run is
 * well under a cent.
 */

import { experimental_evaluate as evaluate } from "ai";
import { Kysely, sql } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

export const JEV_TRIAGE_SCHEMA_VERSION = 1 as const;

const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_LIMIT = 25;
const MAX_ERROR_CHARS = 4000;
const JEV_MODEL = "typesafe-ai/jev";

// ---------------------------------------------------------------------------
// Domain types (pure)
// ---------------------------------------------------------------------------

export type FaultRow = {
	stage_id: string;
	class: string;
	retry_state: string;
	retry_count: number;
	last_error: string | null;
	from_height: number | null;
	to_height: number | null;
	created_at: string;
};

/** The nine classes stage_failures can record (migration 0116). The
 *  descriptions are what Jev sees — they are the entire decision contract. */
export const FAULT_TAXONOMY: Record<string, string> = {
	omission:
		"a decoder silently failed to emit data it should have (event dropped or not decoded)",
	version:
		"decoder or checkpoint version mismatch: unsupported schema, unknown decoder, version errors",
	digest_mismatch:
		"recomputed output digest differs from what was recorded; nondeterministic decode",
	crash:
		"the process crashed or threw an unhandled exception (OOM, panic, segfault)",
	reorg: "a chain reorganization invalidated previously decoded blocks",
	source_gap:
		"source data (streams/raw plane) is missing, gapped, or unavailable",
	handler:
		"downstream handler or subgraph code threw while processing the event",
	timeout: "the operation exceeded its deadline",
	unknown: "none of the above clearly applies",
};

export type Agreement = "agree" | "regex_match" | "disagree" | "skipped";

export type Verdict = {
	stage_id: string;
	recorded: string;
	regex: string | null;
	jev_class: string | null;
	jev_probabilities: Record<string, number> | null;
	jev_confidence: number | null;
	transient_probability: number | null;
	severity: number | null;
	agreement: Agreement;
	note: string | null;
};

export type TriageSummary = {
	schema_version: typeof JEV_TRIAGE_SCHEMA_VERSION;
	model: string;
	evaluated: number;
	skipped: number;
	agree: number;
	regex_match: number;
	disagree: number;
	agreement_rate: number | null;
	low_confidence: number;
	mean_severity: number | null;
	would_page: number;
	verdicts: Verdict[];
	warnings: string[];
};

// ---------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------

/** State an operator would see when paged. The recorded class is deliberately
 *  not included — including it would leak the label we ask Jev to reproduce. */
export function buildTriageState(row: FaultRow): {
	component: string;
	error: string | null;
	block_range: { from: number | null; to: number | null } | null;
	retries_so_far: number;
	context: string;
} {
	return {
		component: row.stage_id,
		error:
			row.last_error === null ? null : row.last_error.slice(0, MAX_ERROR_CHARS),
		block_range:
			row.from_height === null && row.to_height === null
				? null
				: { from: row.from_height, to: row.to_height },
		retries_so_far: row.retry_count,
		context:
			"This is a failure recorded by a blockchain data decoder pipeline " +
			"(Stacks chain). The component decodes chain events into stored rows.",
	};
}

export function triageQuestions() {
	return {
		fault_class: {
			type: "choice" as const,
			instructions:
				"Which fault class best describes this failure? Judge from the " +
				"error text and component alone.",
			criteria: FAULT_TAXONOMY,
		},
		transient: {
			type: "boolean" as const,
			instructions:
				"Would retrying the same operation, with no code or data change, " +
				"plausibly succeed?",
			criteria: {
				true: "the cause looks transient (network, timing, upstream lag)",
				false: "the cause looks durable (bad data, version mismatch, code bug)",
			},
		},
		severity: {
			type: "score" as const,
			instructions:
				"How severe is this failure for the data pipeline operator?",
			criteria: [
				"benign: expected or self-healing, no action needed",
				"minor: worth tracking, fix in passing",
				"major: needs engineer attention soon, data quality at risk",
				"critical: output is halted or corrupt, page someone now",
			],
		},
	};
}

export function verdictFor(opts: {
	row: FaultRow;
	regexClass: string | null;
	jevClass: string | null;
	jevProbabilities: Record<string, number> | null;
	jevConfidence: number | null;
	transientProbability: number | null;
	severity: number | null;
}): Verdict {
	const { row, regexClass, jevClass } = opts;
	let agreement: Agreement = "skipped";
	let note: string | null = null;
	if (jevClass !== null) {
		if (jevClass === row.class) {
			agreement = "agree";
		} else if (regexClass !== null && jevClass === regexClass) {
			agreement = "regex_match";
			note = `jev agrees with regex (${regexClass}), not recorded class`;
		} else {
			agreement = "disagree";
			note = `recorded=${row.class} jev=${jevClass}`;
		}
	}
	return {
		stage_id: row.stage_id,
		recorded: row.class,
		regex: regexClass,
		jev_class: jevClass,
		jev_probabilities: opts.jevProbabilities,
		jev_confidence: opts.jevConfidence,
		transient_probability: opts.transientProbability,
		severity: opts.severity,
		agreement,
		note,
	};
}

const LOW_CONFIDENCE = 0.5;
const PAGE_SEVERITY = 3;

export function summarize(opts: {
	verdicts: Verdict[];
	warnings: string[];
}): TriageSummary {
	const { verdicts, warnings } = opts;
	const evaluated = verdicts.filter((v) => v.agreement !== "skipped");
	const count = (a: Agreement) =>
		verdicts.filter((v) => v.agreement === a).length;
	const severities = evaluated
		.map((v) => v.severity)
		.filter((s): s is number => s !== null);
	return {
		schema_version: JEV_TRIAGE_SCHEMA_VERSION,
		model: JEV_MODEL,
		evaluated: evaluated.length,
		skipped: count("skipped"),
		agree: count("agree"),
		regex_match: count("regex_match"),
		disagree: count("disagree"),
		agreement_rate:
			evaluated.length > 0 ? count("agree") / evaluated.length : null,
		low_confidence: evaluated.filter(
			(v) => v.jev_confidence !== null && v.jev_confidence < LOW_CONFIDENCE,
		).length,
		mean_severity:
			severities.length > 0
				? severities.reduce((a, b) => a + b, 0) / severities.length
				: null,
		would_page: evaluated.filter(
			(v) => v.severity !== null && v.severity >= PAGE_SEVERITY,
		).length,
		verdicts,
		warnings,
	};
}

export function formatReport(summary: TriageSummary): string {
	const lines: string[] = [];
	lines.push(
		`jev fault triage — ${summary.evaluated} evaluated, ` +
			`${summary.skipped} skipped (model=${summary.model})`,
	);
	if (summary.evaluated > 0) {
		lines.push(
			`  agree ${summary.agree}  regex_match ${summary.regex_match}  ` +
				`disagree ${summary.disagree}  ` +
				`(agreement rate ${(summary.agreement_rate ?? 0).toFixed(2)})`,
		);
		lines.push(
			`  mean severity ${summary.mean_severity?.toFixed(2) ?? "n/a"}  ` +
				`would page ${summary.would_page}  ` +
				`low confidence ${summary.low_confidence}`,
		);
	}
	const interesting = summary.verdicts.filter((v) => v.agreement !== "agree");
	if (interesting.length > 0) {
		lines.push("", "non-agree rows:");
		for (const v of interesting) {
			const sev = v.severity === null ? "n/a" : v.severity.toFixed(2);
			const conf =
				v.jev_confidence === null ? "n/a" : v.jev_confidence.toFixed(2);
			const tr =
				v.transient_probability === null
					? "n/a"
					: v.transient_probability.toFixed(2);
			const note = v.note ? ` — ${v.note}` : "";
			lines.push(
				`  [${v.agreement}] ${v.stage_id} recorded=${v.recorded} regex=${v.regex ?? "n/a"} jev=${v.jev_class ?? "n/a"} sev=${sev} conf=${conf} transient=${tr}${note}`,
			);
		}
	}
	for (const w of summary.warnings) lines.push(`warning: ${w}`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

type Args = {
	since_days: number;
	limit: number;
	input: string | null;
	json: boolean;
	stage: string | null;
};

function parseArgs(argv: string[]): Args {
	const args: Args = {
		since_days: DEFAULT_SINCE_DAYS,
		limit: DEFAULT_LIMIT,
		input: null,
		json: false,
		stage: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--since") args.since_days = parseSince(argv[++i]);
		else if (a === "--limit") args.limit = Number(argv[++i]);
		else if (a === "--input") args.input = argv[++i];
		else if (a === "--stage") args.stage = argv[++i];
		else if (a === "--json") args.json = true;
		else throw new Error(`unknown flag: ${a}`);
	}
	return args;
}

function toIsoTimestamp(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

function parseSince(v: string): number {
	const m = /^(\d+)d$/.exec(v);
	if (!m) throw new Error(`--since expects e.g. 30d, got: ${v}`);
	return Number(m[1]);
}

async function fetchFaultRows(dbUrl: string, args: Args): Promise<FaultRow[]> {
	const client = postgres(dbUrl, { max: 1 });
	try {
		const db = new Kysely<Record<string, never>>({
			dialect: new PostgresJSDialect({ postgres: client }),
		});
		const rows = await sql<FaultRow>`
			SELECT stage_id, class, retry_state, retry_count, last_error,
			       from_height, to_height, created_at
			FROM stage_failures
			WHERE created_at > now() - make_interval(days => ${args.since_days})
			  ${args.stage ? sql`AND stage_id = ${args.stage}` : sql``}
			ORDER BY created_at DESC
			LIMIT ${args.limit}
		`.execute(db);
		return rows.rows.map((r) => ({
			...r,
			from_height: r.from_height === null ? null : Number(r.from_height),
			to_height: r.to_height === null ? null : Number(r.to_height),
			created_at: toIsoTimestamp(r.created_at),
		}));
	} finally {
		await client.end();
	}
}

async function readInputRows(path: string): Promise<FaultRow[]> {
	const text = await Bun.file(path).text();
	return text
		.split("\n")
		.filter((l) => l.trim().length > 0)
		.map((l) => JSON.parse(l) as FaultRow);
}

/** The regex heuristic lives in packages/indexer, which imports the built
 *  shared dist. Resolve it dynamically so this script still runs (regex=null)
 *  on a checkout where packages have not been built. */
async function loadRegexClassifier(): Promise<
	((error: unknown) => string) | null
> {
	try {
		const mod = await import(
			"../../packages/indexer/src/decode/generic-commit.ts"
		);
		return mod.classifyGenericDecodeFault as (error: unknown) => string;
	} catch {
		return null;
	}
}

type EvaluateResult = Awaited<ReturnType<typeof evaluate>>;

function readAnswers(result: EvaluateResult): {
	jevClass: string | null;
	jevProbabilities: Record<string, number> | null;
	transientProbability: number | null;
	severity: number | null;
} {
	const answers = result.answers as Record<
		string,
		{ type: string } & Record<string, unknown>
	>;
	const fc = answers.fault_class;
	const tr = answers.transient;
	const sv = answers.severity;
	return {
		jevClass: fc?.type === "choice" ? (fc.choice as string) : null,
		jevProbabilities:
			fc?.type === "choice"
				? (fc.probabilities as Record<string, number>)
				: null,
		transientProbability:
			tr?.type === "boolean" ? (tr.probability as number) : null,
		severity: sv?.type === "score" ? (sv.score as number) : null,
	};
}

/** TypeSafe reports per-question confidence in provider metadata; the exact
 *  shape is not in the AI SDK docs, so read defensively. */
function readConfidence(
	result: EvaluateResult,
	questionId: string,
): number | null {
	const meta = result.providerMetadata?.typesafe as
		| Record<string, unknown>
		| undefined;
	const confidence = meta?.confidence;
	if (typeof confidence === "number") return confidence;
	if (confidence && typeof confidence === "object") {
		const perQuestion = (confidence as Record<string, unknown>)[questionId];
		if (typeof perQuestion === "number") return perQuestion;
	}
	return null;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const warnings: string[] = [];

	const apiKey = process.env.AI_GATEWAY_API_KEY;
	if (!apiKey) {
		console.error(
			"AI_GATEWAY_API_KEY is not set — add it to .env.local " +
				"(Vercel dashboard → AI Gateway → API keys).",
		);
		process.exit(2);
	}

	let rows: FaultRow[];
	if (args.input) {
		rows = await readInputRows(args.input);
	} else {
		const dbUrl =
			process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL || "";
		if (!dbUrl) {
			console.error(
				"no db: set SOURCE_DATABASE_URL or DATABASE_URL, or use --input",
			);
			process.exit(2);
		}
		rows = await fetchFaultRows(dbUrl, args);
	}
	if (rows.length === 0) {
		console.error("no stage_failures rows in window — nothing to evaluate");
		process.exit(2);
	}

	const regexClassify = await loadRegexClassifier();
	if (!regexClassify) {
		warnings.push(
			"indexer regex classifier unavailable (packages not built?) — " +
				"regex column is null",
		);
	}

	const questions = triageQuestions();
	const verdicts: Verdict[] = [];
	for (const row of rows) {
		const regexClass =
			regexClassify && row.last_error ? regexClassify(row.last_error) : null;
		try {
			const result = await evaluate({
				model: JEV_MODEL,
				state: buildTriageState(row),
				questions,
			});
			const a = readAnswers(result);
			verdicts.push(
				verdictFor({
					row,
					regexClass,
					jevClass: a.jevClass,
					jevProbabilities: a.jevProbabilities,
					jevConfidence: readConfidence(result, "fault_class"),
					transientProbability: a.transientProbability,
					severity: a.severity,
				}),
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			warnings.push(`evaluate failed for ${row.stage_id}: ${message}`);
			verdicts.push(
				verdictFor({
					row,
					regexClass,
					jevClass: null,
					jevProbabilities: null,
					jevConfidence: null,
					transientProbability: null,
					severity: null,
				}),
			);
		}
	}

	const summary = summarize({ verdicts, warnings });
	console.log(
		args.json ? JSON.stringify(summary, null, 2) : formatReport(summary),
	);
}

if (import.meta.main) {
	await main();
}
