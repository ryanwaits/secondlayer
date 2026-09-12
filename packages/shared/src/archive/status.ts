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
 *   lagging → the archive trails the chain tip. This is CORRECT and permanent.
 *             Two expected causes: twice-weekly publish (Wednesday and Sunday)
 *             and the finality boundary. Cadence is the bulk of the gap;
 *             finality is hours, not days. An archive that reported `stale`
 *             for its own expected lag would be crying wolf forever, and
 *             consumers would learn to ignore it.
 *   stale   → publishing stopped. The lag exceeds what cadence and the
 *             finality rule can explain, so something is broken.
 *
 * `state` is derived from measurements, never asserted by the publisher, and
 * every unhealthy state is reachable — an archive that can only report health
 * is decoration.
 */

/**
 * v1 is additive. `source.decoder_head` joined the object without a bump:
 * it does not change the meaning of any existing field, and readers already
 * ignore unknown keys. Bump only if a field is renamed, removed, or
 * re-interpreted.
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
		/**
		 * Highest height the Index decoder (`decode.ft_transfer.v1`) has
		 * committed. Null when the checkpoint cannot be read. Distinct from
		 * `archive.coverage_to_block`, which is the last signed publish.
		 */
		decoder_head: number | null;
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
	/**
	 * Index decoder checkpoint height. Null when unread or unreachable.
	 * Reported, never used to derive `state`.
	 */
	decoderHead?: number | null;
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

/** systemd `OnCalendar=Wed,Sun *-*-* 08:00:00`. Host is UTC. Job start, not promotion landing. */
const PUBLISH_HOUR_UTC = 8;
const PUBLISH_WEEKDAYS_UTC = new Set([0, 3]);

/**
 * Next twice-weekly publish fire strictly after `now`. Matches
 * `secondlayer-archive-publish.timer`. Export duration means the promotion
 * lands hours later; this is the scheduled start.
 */
export function nextScheduledArchivePublish(now: Date): Date {
	for (let i = 0; i <= 7; i++) {
		const candidate = new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate() + i,
				PUBLISH_HOUR_UTC,
				0,
				0,
				0,
			),
		);
		if (PUBLISH_WEEKDAYS_UTC.has(candidate.getUTCDay()) && candidate > now) {
			return candidate;
		}
	}
	throw new Error("nextScheduledArchivePublish: no fire in 7 days");
}

function publishWeekdayName(date: Date): "Sunday" | "Wednesday" {
	return date.getUTCDay() === 0 ? "Sunday" : "Wednesday";
}

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
			decoder_head: inputs.decoderHead ?? null,
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

	// Behind the tip. CORRECT and permanent: twice-weekly publish plus the
	// finality boundary. Cadence is the bulk of the gap. Do not call this stale.
	if (behindTip !== null && behindTip > 0) {
		const nextDay = publishWeekdayName(nextScheduledArchivePublish(inputs.now));
		return {
			...base,
			state: "lagging",
			detail: `${behindTip} blocks behind the chain tip, which is expected: publishing is twice weekly (Wednesday and Sunday, next ${nextDay}) and stops at the finality boundary`,
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
