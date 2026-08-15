/**
 * `status.json` — the archive's operational truth, published short-cache from
 * verified state only.
 *
 * Everything else in the tree is immutable and signed, which makes it durable
 * but silent: a consumer holding a valid manifest cannot tell whether it is
 * current, three days behind, or the last thing published before an incident.
 * This object answers that, and it is the only object allowed to say something
 * unflattering.
 *
 * The distinction this file exists to protect:
 *
 *   lagging → the archive trails the chain tip because it only publishes below
 *             the finality boundary. This is CORRECT and permanent. An archive
 *             that reported `stale` for its own finality lag would be crying
 *             wolf forever, and consumers would learn to ignore it.
 *   stale   → publishing stopped. The lag exceeds what the finality rule can
 *             explain, so something is broken.
 *
 * `state` is derived from measurements, never asserted by the publisher, and
 * every unhealthy state is reachable — an archive that can only report health
 * is decoration.
 */

export const ARCHIVE_STATUS_SCHEMA_VERSION = 1;

export type ArchiveState =
	| "fresh"
	| "lagging"
	| "stale"
	| "gap"
	| "failed-audit"
	| "source-unavailable";

export type ArchiveStatus = {
	schema_version: typeof ARCHIVE_STATUS_SCHEMA_VERSION;
	network: string;
	state: ArchiveState;
	/** Human-facing one-liner explaining the state, including WHY. */
	detail: string;
	generated_at: string;
	archive: {
		snapshot_digest: string | null;
		coverage_to_block: number | null;
		promoted_at: string | null;
		signing_key_id: string | null;
	};
	source: {
		/** Chain tip as the publisher last observed it. Null when unreachable. */
		tip_height: number | null;
		/** Highest height eligible to publish under the finality rule. */
		finalized_height: number | null;
	};
	lag: {
		/** Behind the FINALIZED height — the number that indicates a problem. */
		blocks_behind_finalized: number | null;
		/** Behind the raw chain tip — expected to be non-zero forever. */
		blocks_behind_tip: number | null;
		seconds_since_promotion: number | null;
	};
	audit: {
		complete: boolean;
		checked_at: string;
	} | null;
	signature?: string;
	key_id?: string;
};

export type StatusInputs = {
	network: string;
	snapshotDigest: string | null;
	coverageToBlock: number | null;
	promotedAt: string | null;
	signingKeyId: string | null;
	/** Null when the source could not be reached. */
	sourceTipHeight: number | null;
	finalizedHeight: number | null;
	audit: { complete: boolean; checkedAt: string } | null;
	now: Date;
	/**
	 * How far behind the FINALIZED height the archive may fall before it is
	 * stale rather than merely lagging. Publishing one partition covers 50k
	 * blocks, so a healthy archive sits well inside this.
	 */
	maxBlocksBehindFinalized?: number;
	/** How long since the last promotion before staleness, regardless of height. */
	maxSecondsSincePromotion?: number;
};

const DEFAULT_MAX_BLOCKS_BEHIND_FINALIZED = 60_000;
/**
 * Must exceed the publish cadence, or the archive reports `stale` on every
 * healthy cycle and the signal means nothing.
 *
 * The publisher runs Wed + Sun, so the longest gap between promotions in a
 * healthy week is 4 days. Five days leaves a day of grace for a slow export or
 * timer jitter, and still fires two days before the next scheduled attempt
 * whenever a cycle is actually missed.
 *
 * It also lands just inside the height rule: at the observed ~7–9k blocks/day
 * the archive is ~45k blocks behind finalized at the five-day mark, so age
 * trips first and reports the more diagnostic message ("publishing stopped")
 * rather than the symptom.
 */
const DEFAULT_MAX_SECONDS_SINCE_PROMOTION = 5 * 24 * 3_600;

/**
 * Durations here run to days, and "beyond the 120h objective" makes a reader do
 * arithmetic before they can tell whether that is alarming.
 */
function formatAge(seconds: number): string {
	const hours = seconds / 3_600;
	if (hours < 48) return `${Math.round(hours)}h`;
	const days = hours / 24;
	// One decimal only when it changes the reading: 4d and 4.5d are different
	// facts during an incident, 5.0d is noise.
	const rounded = Math.round(days * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}d`;
}

/**
 * Derive status from measurements. Pure, so every state below is reachable in
 * a test rather than only in production at 3am.
 *
 * Order matters: a failing audit outranks freshness, because an archive that
 * is current and wrong is worse than one that is behind and correct.
 */
export function deriveArchiveStatus(inputs: StatusInputs): ArchiveStatus {
	const maxBehind =
		inputs.maxBlocksBehindFinalized ?? DEFAULT_MAX_BLOCKS_BEHIND_FINALIZED;
	const maxAge =
		inputs.maxSecondsSincePromotion ?? DEFAULT_MAX_SECONDS_SINCE_PROMOTION;

	const secondsSincePromotion = inputs.promotedAt
		? Math.max(
				0,
				Math.round(
					(inputs.now.getTime() - Date.parse(inputs.promotedAt)) / 1000,
				),
			)
		: null;

	const behindFinalized =
		inputs.finalizedHeight !== null && inputs.coverageToBlock !== null
			? Math.max(0, inputs.finalizedHeight - inputs.coverageToBlock)
			: null;
	const behindTip =
		inputs.sourceTipHeight !== null && inputs.coverageToBlock !== null
			? Math.max(0, inputs.sourceTipHeight - inputs.coverageToBlock)
			: null;

	const base = {
		schema_version:
			ARCHIVE_STATUS_SCHEMA_VERSION as typeof ARCHIVE_STATUS_SCHEMA_VERSION,
		network: inputs.network,
		generated_at: inputs.now.toISOString(),
		archive: {
			snapshot_digest: inputs.snapshotDigest,
			coverage_to_block: inputs.coverageToBlock,
			promoted_at: inputs.promotedAt,
			signing_key_id: inputs.signingKeyId,
		},
		source: {
			tip_height: inputs.sourceTipHeight,
			finalized_height: inputs.finalizedHeight,
		},
		lag: {
			blocks_behind_finalized: behindFinalized,
			blocks_behind_tip: behindTip,
			seconds_since_promotion: secondsSincePromotion,
		},
		audit: inputs.audit
			? { complete: inputs.audit.complete, checked_at: inputs.audit.checkedAt }
			: null,
	};

	// A failed audit is the loudest signal: current-and-wrong beats behind-and-right.
	if (inputs.audit && !inputs.audit.complete) {
		return {
			...base,
			state: "failed-audit",
			detail: `the canonical audit did not pass at ${inputs.audit.checkedAt}; this archive is not safe to restore from`,
		};
	}

	if (!inputs.snapshotDigest || inputs.coverageToBlock === null) {
		return {
			...base,
			state: "gap",
			detail: "no snapshot is currently promoted",
		};
	}

	// Source unreachable: report the gap in KNOWLEDGE rather than guessing. The
	// archive may be perfectly healthy; we cannot currently say so.
	if (inputs.sourceTipHeight === null || inputs.finalizedHeight === null) {
		return {
			...base,
			state: "source-unavailable",
			detail:
				"the chain source could not be reached, so freshness cannot be determined",
		};
	}

	if (secondsSincePromotion !== null && secondsSincePromotion > maxAge) {
		return {
			...base,
			state: "stale",
			detail: `last promotion was ${formatAge(secondsSincePromotion)} ago, beyond the ${formatAge(maxAge)} freshness objective`,
		};
	}

	if (behindFinalized !== null && behindFinalized > maxBehind) {
		return {
			...base,
			state: "stale",
			detail: `${behindFinalized} blocks behind the finalized height, beyond the ${maxBehind} threshold`,
		};
	}

	// Behind the tip but within the finality boundary — correct, permanent, and
	// explicitly NOT staleness.
	if (behindTip !== null && behindTip > 0) {
		return {
			...base,
			state: "lagging",
			detail: `${behindTip} blocks behind the chain tip, which is expected: only heights below the finality boundary are published`,
		};
	}

	return {
		...base,
		state: "fresh",
		detail: "published through the finalized height",
	};
}

/** States a consumer should refuse to restore from. */
export function isRestorable(state: ArchiveState): boolean {
	return state === "fresh" || state === "lagging";
}
