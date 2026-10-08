#!/usr/bin/env bun
/**
 * Classifier compare — score jev, kev and clef against the same labelled rows
 * so a threshold can be retuned before switching providers.
 *
 * Usage:
 *   bun scripts/ops/classifier-compare.ts \
 *     --questions scripts/ops/slack-gate.ts#SLACK_GATE_QUESTIONS \
 *     --input rows.jsonl --providers jev,kev,clef [--json]
 *
 * The questions export is a questions object or a zero-arg function returning
 * one (SLACK_GATE_QUESTIONS, triageQuestions). Each JSONL row is
 *   { "state": <string|object>, "labels": { "<questionId>": <option | level index | boolean> } }
 *
 * Confidence is not comparable across providers or versions; read the
 * coverage/accuracy pairs per provider and pick each provider's own threshold.
 *
 * Exit codes: 0 ran, 2 bad usage or no provider produced any answer.
 * Env: provider credentials as in packages/shared/src/classify/providers.ts.
 */

import { resolve } from "node:path";
import {
	type Answer,
	type ClassifierName,
	type Question,
	classify,
} from "../../packages/shared/src/classify/index.ts";

export const THRESHOLDS = ["0.6", "0.7", "0.85", "0.9"] as const;

export type Label = string | number | boolean;
export type QuestionScore = {
	correct: boolean | null;
	confidence: number | null;
};
/** One row's per-question scores; null when the classifier returned nothing. */
export type ScoredRow = Record<string, QuestionScore> | null;

export type QuestionSummary = {
	n: number;
	accuracy: number | null;
	at: Record<
		(typeof THRESHOLDS)[number],
		{ coverage: number | null; accuracy: number | null }
	>;
	failures: number;
};
export type ProviderSummary = Record<string, QuestionSummary>;

function argmaxLevel(probabilities: Record<string, number>): number | null {
	let best: number | null = null;
	let bestP = Number.NEGATIVE_INFINITY;
	for (const [level, p] of Object.entries(probabilities)) {
		if (p > bestP) {
			bestP = p;
			best = Number(level);
		}
	}
	return best;
}

function scoreAnswer(answer: Answer, label: Label): QuestionScore {
	switch (answer.type) {
		case "choice":
			return {
				correct: answer.choice === label,
				confidence: answer.confidence,
			};
		case "boolean":
			return {
				correct: answer.probability >= 0.5 === label,
				confidence: answer.confidence,
			};
		case "score": {
			const level =
				Object.keys(answer.probabilities).length > 0
					? argmaxLevel(answer.probabilities)
					: Math.round(answer.score);
			return { correct: level === label, confidence: answer.confidence };
		}
		default:
			return { correct: null, confidence: null };
	}
}

export function scoreRow(
	questions: Record<string, Question>,
	labels: Record<string, Label>,
	answers: Record<string, Answer>,
): Record<string, QuestionScore> {
	const out: Record<string, QuestionScore> = {};
	for (const id of Object.keys(questions)) {
		const answer = answers[id];
		const label = labels[id];
		out[id] =
			answer === undefined || label === undefined
				? { correct: null, confidence: null }
				: scoreAnswer(answer, label);
	}
	return out;
}

export function summarizeProvider(
	questionIds: string[],
	rows: ScoredRow[],
): ProviderSummary {
	const out: ProviderSummary = {};
	for (const id of questionIds) {
		const scored = rows.flatMap((r) => {
			const s = r?.[id];
			return s && s.correct !== null ? [s] : [];
		});
		const rate = (xs: QuestionScore[]) =>
			xs.length > 0 ? xs.filter((x) => x.correct).length / xs.length : null;
		const at = {} as QuestionSummary["at"];
		for (const t of THRESHOLDS) {
			const covered = scored.filter(
				(s) => s.confidence !== null && s.confidence >= Number(t),
			);
			at[t] = {
				coverage: scored.length > 0 ? covered.length / scored.length : null,
				accuracy: rate(covered),
			};
		}
		out[id] = {
			n: scored.length,
			accuracy: rate(scored),
			at,
			failures: rows.filter((r) => r === null).length,
		};
	}
	return out;
}

const pct = (x: number | null) =>
	x === null ? "-" : `${(x * 100).toFixed(0)}%`;

export function formatComparison(
	summaries: Record<string, ProviderSummary>,
): string {
	const header = [
		"provider",
		"question",
		"n",
		"fail",
		"acc",
		...THRESHOLDS.map((t) => `>=${t} cov/acc`),
	];
	const lines: string[][] = [header];
	for (const [provider, summary] of Object.entries(summaries)) {
		for (const [id, q] of Object.entries(summary)) {
			lines.push([
				provider,
				id,
				String(q.n),
				String(q.failures),
				pct(q.accuracy),
				...THRESHOLDS.map(
					(t) => `${pct(q.at[t].coverage)}/${pct(q.at[t].accuracy)}`,
				),
			]);
		}
	}
	const widths = header.map((_, i) =>
		Math.max(...lines.map((l) => (l[i] as string).length)),
	);
	return lines
		.map((l) =>
			l
				.map((c, i) => c.padEnd(widths[i] as number))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

const USAGE =
	"usage: bun scripts/ops/classifier-compare.ts --questions <module.ts>#<export> " +
	"--input rows.jsonl --providers jev,kev,clef [--json]";

type Args = {
	questions: string | null;
	input: string | null;
	providers: string[];
	json: boolean;
	help: boolean;
};

function parseArgs(argv: string[]): Args {
	const args: Args = {
		questions: null,
		input: null,
		providers: [],
		json: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--questions") args.questions = argv[++i] ?? null;
		else if (a === "--input") args.input = argv[++i] ?? null;
		else if (a === "--providers")
			args.providers = (argv[++i] ?? "").split(",").filter(Boolean);
		else if (a === "--json") args.json = true;
		else if (a === "--help" || a === "-h") args.help = true;
	}
	return args;
}

async function loadQuestions(spec: string): Promise<Record<string, Question>> {
	const [path, exportName] = spec.split("#");
	if (!path || !exportName)
		throw new Error("--questions needs <path>#<export>");
	const mod = (await import(resolve(path))) as Record<string, unknown>;
	const exported = mod[exportName];
	const value = typeof exported === "function" ? exported() : exported;
	if (!value || typeof value !== "object") {
		throw new Error(`export ${exportName} is not a questions object`);
	}
	return value as Record<string, Question>;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(USAGE);
		return;
	}
	if (!args.questions || !args.input || args.providers.length === 0) {
		console.error(USAGE);
		process.exit(2);
	}
	const valid: ClassifierName[] = ["jev", "kev", "clef"];
	const providers = args.providers.filter((p): p is ClassifierName =>
		(valid as string[]).includes(p),
	);
	if (providers.length !== args.providers.length) {
		console.error(`providers must be a subset of ${valid.join(",")}`);
		process.exit(2);
	}

	const questions = await loadQuestions(args.questions);
	const text = await Bun.file(args.input).text();
	const rows = text
		.split("\n")
		.filter((l) => l.trim())
		.map(
			(l) =>
				JSON.parse(l) as {
					state: string | Record<string, unknown>;
					labels: Record<string, Label>;
				},
		);

	const summaries: Record<string, ProviderSummary> = {};
	let answered = 0;
	for (const provider of providers) {
		const scored: ScoredRow[] = [];
		for (const row of rows) {
			const result = await classify({
				state: row.state,
				questions,
				provider,
				timeoutMs: 30000,
			});
			if (!result) {
				scored.push(null);
				continue;
			}
			answered++;
			scored.push(
				scoreRow(
					questions,
					row.labels,
					result.answers as Record<string, Answer>,
				),
			);
		}
		summaries[provider] = summarizeProvider(Object.keys(questions), scored);
	}
	if (answered === 0) {
		console.error("no provider produced any answer — check credentials");
		process.exit(2);
	}
	console.log(
		args.json
			? JSON.stringify(summaries, null, 2)
			: formatComparison(summaries),
	);
}

if (import.meta.main) {
	await main();
}
