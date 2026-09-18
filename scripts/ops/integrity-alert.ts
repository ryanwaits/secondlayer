#!/usr/bin/env bun
/**
 * Host-side /health/integrity pager. Unfillable gaps and broken canonical
 * links are already-decided incidents — page --force / recover --recovery,
 * never classify.
 *
 * Usage:
 *   printf '%s' "$body" | bun scripts/ops/integrity-alert.ts --had-incident=0 --fetch-ok=1
 *
 * Prints JSON { action, reason, status, message }. Exit 0 always — a timer
 * must not fail because Slack blipped.
 */

export const PAGE_STATUSES = ["gaps_unfillable", "chain_unlinked"] as const;

export type IntegrityStatus =
	| "healthy"
	| "degraded"
	| "gaps_detected"
	| "gaps_unfillable"
	| "chain_unlinked"
	| string;

export type IntegrityDecision = {
	action: "page" | "recovery" | "quiet";
	reason: string;
};

export function decideIntegrityAlert(opts: {
	status: string | undefined;
	hadIncident: boolean;
	fetchOk: boolean;
}): IntegrityDecision {
	if (!opts.fetchOk) {
		return { action: "quiet", reason: "fetch_failed" };
	}
	if (
		opts.status !== undefined &&
		(PAGE_STATUSES as readonly string[]).includes(opts.status)
	) {
		return { action: "page", reason: "force" };
	}
	if (opts.status === "healthy" && opts.hadIncident) {
		return { action: "recovery", reason: "recovery" };
	}
	if (opts.status === "healthy") {
		return { action: "quiet", reason: "healthy_clean" };
	}
	if (opts.status === "gaps_detected" || opts.status === "degraded") {
		return { action: "quiet", reason: "in_progress" };
	}
	return { action: "quiet", reason: "unknown_status" };
}

function asRecord(v: unknown): Record<string, unknown> | null {
	return v !== null && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function formatHeights(heights: unknown): string | null {
	if (!Array.isArray(heights) || heights.length === 0) return null;
	return heights.map(String).join(", ");
}

export function buildIntegrityMessage(
	status: string | undefined,
	body: Record<string, unknown> | null,
): string {
	if (status === "gaps_unfillable") {
		const progress = asRecord(body?.autoBackfillProgress);
		const heights = formatHeights(progress?.unfillableHeights);
		const n =
			typeof progress?.unfillable === "number"
				? progress.unfillable
				: heights
					? heights.split(", ").length
					: null;
		if (n !== null && heights) {
			return `🚨 Indexer: gaps_unfillable — ${n} block(s) unfillable (heights ${heights}) — needs manual repair, see packages/indexer/REPAIR-GUIDE.md`;
		}
		if (n !== null) {
			return `🚨 Indexer: gaps_unfillable — ${n} block(s) unfillable — needs manual repair, see packages/indexer/REPAIR-GUIDE.md`;
		}
		return "🚨 Indexer: gaps_unfillable — needs manual repair, see packages/indexer/REPAIR-GUIDE.md";
	}
	if (status === "chain_unlinked") {
		const heights = formatHeights(body?.brokenLinks);
		if (heights) {
			return `🚨 Indexer: chain_unlinked — canonical parent_hash mismatch at height(s) ${heights} — re-ingest from the node`;
		}
		return "🚨 Indexer: chain_unlinked — canonical parent_hash mismatch — re-ingest from the node";
	}
	if (status === "healthy") {
		return "✅ Indexer: integrity recovered — /health/integrity status=healthy";
	}
	return "";
}

type Args = {
	hadIncident: boolean;
	fetchOk: boolean;
};

function flagValue(
	argv: string[],
	i: number,
	prefix: string,
): [string, number] {
	const a = argv[i] ?? "";
	if (a === prefix) return [argv[i + 1] ?? "0", i + 1];
	if (a.startsWith(`${prefix}=`)) return [a.slice(prefix.length + 1), i];
	return ["0", i];
}

function isTruthy(v: string): boolean {
	return v === "1" || v === "true";
}

function parseArgs(argv: string[]): Args {
	const args: Args = { hadIncident: false, fetchOk: true };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] ?? "";
		if (a === "--had-incident" || a.startsWith("--had-incident=")) {
			const [v, next] = flagValue(argv, i, "--had-incident");
			args.hadIncident = isTruthy(v);
			i = next;
		} else if (a === "--fetch-ok" || a.startsWith("--fetch-ok=")) {
			const [v, next] = flagValue(argv, i, "--fetch-ok");
			args.fetchOk = isTruthy(v);
			i = next;
		} else {
			throw new Error(`unknown flag: ${a}`);
		}
	}
	return args;
}

async function main(): Promise<void> {
	let action: IntegrityDecision["action"] = "quiet";
	let reason = "unknown_status";
	let status: string | undefined;
	let message = "";
	try {
		const args = parseArgs(process.argv.slice(2));
		const raw = await new Response(Bun.stdin.stream()).text();
		let body: Record<string, unknown> | null = null;
		try {
			body = asRecord(JSON.parse(raw));
		} catch {
			body = null;
		}
		status = typeof body?.status === "string" ? body.status : undefined;
		const decision = decideIntegrityAlert({
			status,
			hadIncident: args.hadIncident,
			fetchOk: args.fetchOk,
		});
		action = decision.action;
		reason = decision.reason;
		message = buildIntegrityMessage(status, body);
	} catch {
		action = "quiet";
		reason = "fetch_failed";
		status = undefined;
		message = "";
	}
	console.log(
		JSON.stringify({
			action,
			reason,
			status: status ?? null,
			message,
		}),
	);
}

if (import.meta.main) {
	await main();
}
