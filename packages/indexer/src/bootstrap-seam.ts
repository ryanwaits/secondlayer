/**
 * Plan the archive → spool → live handoff.
 *
 * During a multi-hour import the indexer journals observer POSTs and does
 * not write blocks. After the archive lands, this planner decides which
 * journaled blocks to ingest, which to skip as archive duplicates, and
 * when to refuse (wrong fork, stale archive).
 *
 * A gap is not a refusal. Blocks missing from both the archive and the journal
 * can only come from a later archive repair; holding back the journaled blocks
 * past the gap would only widen it, since the indexer goes live either way.
 * The plan names each gap so the caller can surface it.
 */

export type SpoolEvent = {
	sequence: string;
	height: number;
	hash: string;
	parentHash: string;
};

export type SeamGap = { from: number; to: number };

export type SeamPlan =
	| {
			status: "ready";
			consume: SpoolEvent[];
			skip: SpoolEvent[];
			gaps: SeamGap[];
	  }
	| {
			status: "wrong_fork";
			expectedParent: string;
			got: string;
			height: number;
	  }
	| {
			status: "stale_archive";
			archiveTip: number;
			nodeTip: number;
			journalTip: number;
	  };

export function planBootstrapSeam(input: {
	archiveTip: number;
	archiveTipHash: string | null;
	nodeTip: number | null;
	events: SpoolEvent[];
}): SeamPlan {
	const ordered = [...input.events].sort((a, b) =>
		a.height === b.height
			? a.sequence.localeCompare(b.sequence)
			: a.height - b.height,
	);
	const skip = ordered.filter((event) => event.height <= input.archiveTip);
	const consume = ordered.filter((event) => event.height > input.archiveTip);

	const journalTip =
		consume.length > 0
			? consume[consume.length - 1].height
			: skip.length > 0
				? skip[skip.length - 1].height
				: input.archiveTip;

	if (
		input.nodeTip !== null &&
		input.nodeTip > journalTip &&
		journalTip < input.nodeTip
	) {
		return {
			status: "stale_archive",
			archiveTip: input.archiveTip,
			nodeTip: input.nodeTip,
			journalTip,
		};
	}

	if (consume.length === 0) {
		return { status: "ready", consume, skip, gaps: [] };
	}

	const gaps: SeamGap[] = [];
	const first = consume[0];
	if (first.height > input.archiveTip + 1) {
		gaps.push({ from: input.archiveTip + 1, to: first.height - 1 });
	}

	if (
		input.archiveTipHash &&
		first.height === input.archiveTip + 1 &&
		first.parentHash !== input.archiveTipHash
	) {
		return {
			status: "wrong_fork",
			expectedParent: input.archiveTipHash,
			got: first.parentHash,
			height: first.height,
		};
	}

	for (let i = 1; i < consume.length; i++) {
		const prev = consume[i - 1];
		const curr = consume[i];
		if (curr.height === prev.height) continue;
		if (curr.height > prev.height + 1) {
			gaps.push({ from: prev.height + 1, to: curr.height - 1 });
		}
	}

	return { status: "ready", consume, skip, gaps };
}
