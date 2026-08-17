/**
 * One reading of `/public/status`, shared by `status`, `doctor`, and `context`.
 *
 * These three commands used to each interpret the same payload on their own and
 * disagreed in the most common first-run state: on a freshly self-hosted
 * instance with no chain data, `status` printed DEGRADED while `doctor` printed
 * "All checks passed", and neither named the cause or a next command. An
 * operator (or an agent) reading both had no way to tell whether it was safe to
 * proceed. The verdict now lives here so the surfaces cannot drift apart, and
 * every issue carries the exact command that resolves it.
 */

export interface PublicStatusDecoder {
	decoder: string;
	status: string;
}

export interface PublicStatusService {
	name: string;
	status: string;
}

/** The subset of `/public/status` a diagnosis reads. Everything is optional:
 *  an older instance may not send a field, and a missing field must never be
 *  read as a failure. */
export interface PublicStatus {
	status?: string;
	chainTip?: number | null;
	chainIntegrity?: {
		ok?: boolean;
		maxHeight?: number;
		reason?: string | null;
	};
	streams?: {
		status?: string;
		tip?: { lag_seconds?: number; block_height?: number } | null;
	};
	index?: { status?: string; decoders?: PublicStatusDecoder[] };
	services?: PublicStatusService[];
	timestamp?: string;
	[key: string]: unknown;
}

export interface InstanceIssue {
	/** What is wrong, in one line. */
	title: string;
	/** Why — assembled only from what the payload actually reports. */
	detail?: string;
	/** What to run next, most useful first. */
	nextSteps: string[];
}

export type InstanceState = "healthy" | "empty-index" | "degraded";

export interface InstanceDiagnosis {
	state: InstanceState;
	/** The API's own top-level verdict, passed through unmodified. */
	overall: string;
	issues: InstanceIssue[];
}

export const BOOTSTRAP_STEP =
	"Restore verified history: secondlayer bootstrap --against <manifest>";
export const OBSERVER_STEP =
	"Confirm your node streams into this instance — secondlayer observer --mode indexer --endpoint secondlayer:3700 prints the stanza its config needs";
export const SELF_HOST_DOCS_STEP =
	"Docs: https://www.secondlayer.tools/docs/self-host";

/** `true` when the instance is reachable but has never indexed a block. */
export function hasNoChainData(status: PublicStatus): boolean {
	const integrity = status.chainIntegrity;
	// `check_failed` is the API's placeholder when the integrity query itself
	// errored — its maxHeight of 0 means "unknown", not "empty".
	if (!integrity || integrity.reason === "check_failed") return false;
	if (integrity.maxHeight !== 0) return false;
	return (status.chainTip ?? null) === null;
}

function emptyIndexIssue(status: PublicStatus): InstanceIssue {
	const decoders = status.index?.decoders ?? [];
	const stalled = decoders.filter((d) => d.status !== "ok").length;
	const decoderClause =
		stalled > 0
			? ` and ${stalled} decoder${stalled === 1 ? "" : "s"} report unavailable because there is nothing to decode`
			: "";
	return {
		title: "No blocks indexed yet — this instance holds 0 blocks.",
		detail: `Streams has no tip${decoderClause}, which is what makes the overall status DEGRADED. This is the expected state for a fresh instance: nothing is broken, but no read returns data until history lands.`,
		nextSteps: [BOOTSTRAP_STEP, OBSERVER_STEP, SELF_HOST_DOCS_STEP],
	};
}

const SERVICE_STEPS = [
	"See the raw per-service report: secondlayer status --json",
	"Check the containers from docker/oss: docker compose ps, then docker compose logs --tail=50 secondlayer",
];

/**
 * Turn a `/public/status` payload into a verdict plus zero or more issues.
 * Only facts present in the payload become issues — when the API says degraded
 * and names no failing surface, the issue says exactly that rather than
 * guessing a cause.
 */
export function diagnoseInstanceStatus(
	status: PublicStatus,
): InstanceDiagnosis {
	const overall = String(status.status ?? "unknown");

	if (hasNoChainData(status)) {
		return { state: "empty-index", overall, issues: [emptyIndexIssue(status)] };
	}

	const issues: InstanceIssue[] = [];
	for (const service of status.services ?? []) {
		if (service.status === "ok") continue;
		issues.push({
			title: `Service ${service.name} reports ${service.status}.`,
			nextSteps: SERVICE_STEPS,
		});
	}

	const integrity = status.chainIntegrity;
	if (integrity && integrity.ok === false) {
		issues.push({
			title: "Chain-data integrity check failed.",
			detail:
				integrity.reason ??
				"The tip the instance serves is not backed by the history it implies.",
			nextSteps: [
				"Verify against the archive: secondlayer verify all --against <manifest>",
				"Repair what diverged: secondlayer repair --against <manifest> --apply",
			],
		});
	}

	if (issues.length === 0 && overall !== "healthy") {
		// Do not invent a cause: report the contradiction and where to look.
		issues.push({
			title: `The API reports status=${overall} but names no failing service.`,
			detail:
				"Every service in the report is ok, so the degradation is in a surface this command does not summarize.",
			nextSteps: SERVICE_STEPS,
		});
	}

	return {
		state: issues.length > 0 ? "degraded" : "healthy",
		overall,
		issues,
	};
}

// ── context ────────────────────────────────────────────────────────────

export interface ContextProbe {
	/** The endpoint the snapshot was read from. */
	apiUrl: string;
	/** `false` only for the metered archive deployment, which has accounts. */
	selfHosted: boolean;
	/** `true` when INSTANCE_TOKEN / SL_API_KEY resolved to a value. */
	hasCredential: boolean;
	/** `/public/status` when it answered, `null` when the probe failed. */
	status: PublicStatus | null;
	/** Why the probe failed, when it did. */
	statusError?: string;
}

export interface ContextExplanation {
	/** One line naming the likeliest cause of the nulls below. */
	summary: string;
	/** Per-null-field reason. Fields that carry a value are absent. */
	nulls: Record<string, string>;
}

const CONTEXT_FIELDS = [
	"account",
	"streamsTip",
	"indexTip",
	"subgraphs",
	"subscriptions",
	"activeOperations",
] as const;

/**
 * Explain every null in a `context` snapshot.
 *
 * The SDK degrades each read to `null` on failure, so an all-null snapshot is
 * indistinguishable from "not bootstrapped", "unauthorized", and "broken" —
 * which is exactly what a caller needs to tell apart. Each reason here is
 * derived from a live probe of the same instance, never assumed.
 */
export function explainContextNulls(
	snapshot: Record<string, unknown>,
	probe: ContextProbe,
): ContextExplanation {
	const nullFields = CONTEXT_FIELDS.filter(
		(field) => (snapshot[field] ?? null) === null,
	);

	if (nullFields.length === 0) {
		return { summary: "Every field resolved.", nulls: {} };
	}

	if (!probe.status) {
		const reason = `No instance answered at ${probe.apiUrl} (${probe.statusError ?? "unreachable"}), so this read never reached an API.`;
		return {
			summary: `${reason} Start it from docker/oss with: docker compose up -d — or point SL_API_URL at the instance you meant.`,
			nulls: Object.fromEntries(nullFields.map((field) => [field, reason])),
		};
	}

	const emptyIndex = hasNoChainData(probe.status);
	const blocks = probe.status.chainIntegrity?.maxHeight ?? null;
	const accountReason = probe.selfHosted
		? "Expected: a self-hosted instance has no account system. Accounts exist only on the metered archive deployment at api.secondlayer.tools, so null here is normal and not a failure."
		: "Not authenticated — run `secondlayer login`, or export INSTANCE_TOKEN.";

	// An empty index explains the chain tips and nothing else: the subgraph and
	// subscription lists are control-plane reads that answer on a bare instance.
	const listReason = unresolvedReadReason(probe, blocks);
	const chainReason = emptyIndex
		? `No blocks indexed yet — this instance holds 0 blocks, so there is no tip to report. ${BOOTSTRAP_STEP}`
		: listReason;

	const nulls: Record<string, string> = {};
	for (const field of nullFields) {
		if (field === "account") nulls[field] = accountReason;
		else if (field === "streamsTip" || field === "indexTip")
			nulls[field] = chainReason;
		else if (field === "activeOperations")
			nulls[field] =
				(snapshot.subgraphs ?? null) === null
					? "Not probed: in-flight operations are read per subgraph, and the subgraph list did not resolve."
					: listReason;
		else nulls[field] = listReason;
	}

	const summary = emptyIndex
		? `Instance at ${probe.apiUrl} is reachable but holds 0 blocks — the chain fields are null because nothing has been indexed yet. ${BOOTSTRAP_STEP}`
		: nullFields.length === 1 && nullFields[0] === "account"
			? `Instance at ${probe.apiUrl} is reachable and indexed to block ${blocks ?? "unknown"}; only \`account\` is null, which is normal when self-hosting.`
			: `Instance at ${probe.apiUrl} is reachable, but ${nullFields.length} field${nullFields.length === 1 ? "" : "s"} did not resolve — see \`nulls\` below for each one.`;

	return { summary, nulls };
}

function unresolvedReadReason(
	probe: ContextProbe,
	blocks: number | null,
): string {
	const where = `The instance at ${probe.apiUrl} is reachable${blocks !== null ? ` and indexed to block ${blocks}` : ""}, but this read returned nothing.`;
	return probe.hasCredential
		? `${where} Check the surface directly: secondlayer status --json`
		: `${where} No credential resolved: export INSTANCE_TOKEN — an instance published past loopback requires it on every /v1 read.`;
}
