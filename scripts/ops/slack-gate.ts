#!/usr/bin/env bun
/**
 * Slack page gate — Jev classifies an ops message and we only POST to the
 * webhook when the model is sure it is page-worthy.
 *
 * Thresholds live here, not in the prompt:
 *   page_now >= 0.8  AND  severity >= 3
 *
 * `--force` skips the model (health-alert CRITICAL stall — already decided).
 * `--recovery` always posts all-clears.
 * Eval/gateway/import failure fail-OPEN (post) so a dead model cannot mute
 * a real page. Missing SLACK_WEBHOOK_URL is a silent no-op.
 *
 * Usage:
 *   printf '%s' "$msg" | bun scripts/ops/slack-gate.ts
 *   bun scripts/ops/slack-gate.ts --force --text "$msg"
 *   bun scripts/ops/slack-gate.ts --recovery --text "$msg"
 *   bun scripts/ops/slack-gate.ts --dry-run --text "$msg"
 *
 * Exit 0 always — a timer must not fail because Slack or Jev blipped.
 */

import { experimental_evaluate as evaluate } from "ai";

export const SLACK_GATE_SCHEMA_VERSION = 1 as const;
export const PAGE_NOW_MIN = 0.8;
export const SEVERITY_MIN = 3;
const JEV_MODEL = "typesafe-ai/jev";

export const SLACK_GATE_QUESTIONS = {
	kind: {
		type: "choice" as const,
		instructions: "What kind of ops event is this Slack message?",
		criteria: {
			deploy_ci:
				"GitHub Actions deploy/smoke/skip/version-bump notification, not a production incident",
			deploy_window:
				"status 502/503 or container unhealthy during an overlapping deploy; expected blip",
			ingest_stall:
				"chain tip not advancing; archive/decoders/API frozen behind indexer or node",
			decoder_health:
				"decoder container unhealthy or decode lag, not explained as quiet-chain",
			audit_job:
				"canonical-audit, floor-audit, or coverage audit script failed (OOM, bad args, exit code)",
			archive_job:
				"archive publish/status/export failed or stale (timeout, lagging status.json)",
			staging_health:
				"staging-health timer: journal/streams lag or pending, not prod ingest",
			vuln_scan: "bun/npm audit finding, not a runtime incident",
			recovery: "an earlier alert recovered; all-clear, not a new incident",
		},
	},
	page_now: {
		type: "boolean" as const,
		instructions:
			"Should an on-call engineer be paged immediately, as opposed to logging or waiting for the next deploy/recovery message?",
		criteria: {
			true: "ongoing production data-plane failure that will not self-resolve in a known deploy window",
			false:
				"CI noise, expected deploy blip, recovery, or a timer that usually self-heals",
		},
	},
	severity: {
		type: "score" as const,
		instructions: "How urgent is operator attention?",
		criteria: [
			"ignore: routine CI, version bumps, deploy skipped",
			"note: recovered already, or known-benign timer",
			"investigate: real failure, can wait minutes",
			"page: data plane stalled or corrupt right now",
		],
	},
};

export type GateDecision = {
	post: boolean;
	reason:
		| "force"
		| "recovery"
		| "threshold"
		| "below_threshold"
		| "fail_open"
		| "no_webhook";
	kind: string | null;
	page_now: number | null;
	severity: number | null;
};

export function decideGate(opts: {
	force: boolean;
	recovery: boolean;
	pageNow: number | null;
	severity: number | null;
	kind: string | null;
	hasWebhook: boolean;
}): GateDecision {
	if (!opts.hasWebhook) {
		return {
			post: false,
			reason: "no_webhook",
			kind: opts.kind,
			page_now: opts.pageNow,
			severity: opts.severity,
		};
	}
	if (opts.force) {
		return {
			post: true,
			reason: "force",
			kind: opts.kind,
			page_now: opts.pageNow,
			severity: opts.severity,
		};
	}
	if (opts.recovery) {
		return {
			post: true,
			reason: "recovery",
			kind: opts.kind,
			page_now: opts.pageNow,
			severity: opts.severity,
		};
	}
	if (opts.pageNow === null || opts.severity === null) {
		return {
			post: true,
			reason: "fail_open",
			kind: opts.kind,
			page_now: opts.pageNow,
			severity: opts.severity,
		};
	}
	const pass = opts.pageNow >= PAGE_NOW_MIN && opts.severity >= SEVERITY_MIN;
	return {
		post: pass,
		reason: pass ? "threshold" : "below_threshold",
		kind: opts.kind,
		page_now: opts.pageNow,
		severity: opts.severity,
	};
}

type Args = {
	force: boolean;
	recovery: boolean;
	dry_run: boolean;
	json: boolean;
	text: string | null;
};

function parseArgs(argv: string[]): Args {
	const args: Args = {
		force: false,
		recovery: false,
		dry_run: false,
		json: false,
		text: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--force") args.force = true;
		else if (a === "--recovery") args.recovery = true;
		else if (a === "--dry-run") args.dry_run = true;
		else if (a === "--json") args.json = true;
		else if (a === "--text") args.text = argv[++i] ?? "";
		else throw new Error(`unknown flag: ${a}`);
	}
	return args;
}

async function readText(args: Args): Promise<string> {
	if (args.text !== null) return args.text;
	return await new Response(Bun.stdin.stream()).text();
}

async function classify(text: string): Promise<{
	kind: string | null;
	pageNow: number | null;
	severity: number | null;
}> {
	if (!process.env.AI_GATEWAY_API_KEY) {
		return { kind: null, pageNow: null, severity: null };
	}
	const result = await evaluate({
		model: JEV_MODEL,
		state: text,
		questions: SLACK_GATE_QUESTIONS,
	});
	const answers = result.answers as Record<
		string,
		{ type: string } & Record<string, unknown>
	>;
	const kind = answers.kind;
	const page = answers.page_now;
	const sev = answers.severity;
	return {
		kind: kind?.type === "choice" ? (kind.choice as string) : null,
		pageNow: page?.type === "boolean" ? (page.probability as number) : null,
		severity: sev?.type === "score" ? (sev.score as number) : null,
	};
}

async function postWebhook(text: string): Promise<void> {
	const url = process.env.SLACK_WEBHOOK_URL;
	if (!url) return;
	await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ text }),
	});
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const text = (await readText(args)).trim();
	if (text.length === 0) return;

	let kind: string | null = null;
	let pageNow: number | null = null;
	let severity: number | null = null;
	if (!args.force && !args.recovery) {
		try {
			const classified = await classify(text);
			kind = classified.kind;
			pageNow = classified.pageNow;
			severity = classified.severity;
		} catch {
			kind = null;
			pageNow = null;
			severity = null;
		}
	}

	const decision = decideGate({
		force: args.force,
		recovery: args.recovery,
		pageNow,
		severity,
		kind,
		hasWebhook: Boolean(process.env.SLACK_WEBHOOK_URL),
	});

	if (args.json) {
		console.log(JSON.stringify({ ...decision, text }, null, 2));
	} else {
		const kind = decision.kind ? ` kind=${decision.kind}` : "";
		const page =
			decision.page_now !== null
				? ` page_now=${decision.page_now.toFixed(2)}`
				: "";
		const sev =
			decision.severity !== null
				? ` severity=${decision.severity.toFixed(2)}`
				: "";
		console.log(
			`slack-gate ${decision.post ? "post" : "drop"} reason=${decision.reason}${kind}${page}${sev}`,
		);
	}

	if (decision.post && !args.dry_run) {
		try {
			await postWebhook(text);
		} catch {
			// timer must not fail on a webhook blip
		}
	}
}

if (import.meta.main) {
	await main();
}
