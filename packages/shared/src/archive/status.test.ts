import { describe, expect, test } from "bun:test";
import {
	type StatusInputs,
	deriveArchiveStatus,
	isRestorable,
	nextScheduledArchivePublish,
} from "./status.ts";

/**
 * The fixture matrix P1.15 asks for: fresh, expected-finality-lag, stale, gap,
 * failed-audit, source-down, and key rotation.
 *
 * The pair that matters is lagging vs stale. The archive trails the chain tip
 * permanently and by design, so an implementation that called that "stale"
 * would cry wolf forever and train consumers to ignore the field.
 */

const NOW = new Date("2026-08-12T12:00:00.000Z");

function inputs(overrides: Partial<StatusInputs> = {}): StatusInputs {
	return {
		network: "mainnet",
		snapshotDigest: "7ca39e7c",
		coverageToBlock: 8_745_422,
		promotedAt: "2026-08-12T11:00:00.000Z",
		signingKeyId: "fHQWzs9ML2WIYakf",
		sourceTipHeight: 8_745_460,
		finalizedHeight: 8_745_422,
		audit: { complete: true, checkedAt: "2026-08-12T06:30:00.000Z" },
		now: NOW,
		...overrides,
	};
}

describe("archive status", () => {
	test("published through the finalized height is fresh", () => {
		const status = deriveArchiveStatus(inputs({ sourceTipHeight: 8_745_422 }));
		expect(status.state).toBe("fresh");
	});

	test("behind the tip but inside the finality boundary is LAGGING, not stale", () => {
		// 38 blocks behind the tip, 0 behind finalized. This is the steady state
		// of a healthy archive and must never read as a problem.
		const status = deriveArchiveStatus(inputs());
		expect(status.state).toBe("lagging");
		expect(status.lag.blocks_behind_tip).toBe(38);
		expect(status.lag.blocks_behind_finalized).toBe(0);
		expect(status.detail).toContain("expected");
		expect(status.detail).toContain("twice weekly");
		expect(status.detail).toContain("next Sunday");
		expect(isRestorable(status.state)).toBe(true);
	});

	test("lagging detail names cadence as the dominant term, not only finality", () => {
		// 26k behind is a healthy Wed→Sun gap, not a 6-confirmation window.
		// The old string blamed finality for the whole number and sent operators
		// looking for a bug.
		const saturday = new Date("2026-08-15T12:00:00.000Z");
		const status = deriveArchiveStatus(
			inputs({
				now: saturday,
				coverageToBlock: 8_718_000,
				sourceTipHeight: 8_745_460,
				finalizedHeight: 8_745_400,
			}),
		);
		expect(status.state).toBe("lagging");
		expect(status.detail).toContain("Wednesday and Sunday");
		expect(status.detail).toContain("next Sunday");
		expect(status.detail).not.toMatch(
			/only heights below the finality boundary are published$/,
		);
	});

	test("after Sunday's scheduled start, lagging detail points at Wednesday", () => {
		const sundayAfternoon = new Date("2026-08-16T12:00:00.000Z");
		const status = deriveArchiveStatus(
			inputs({
				now: sundayAfternoon,
				promotedAt: "2026-08-16T11:00:00.000Z",
			}),
		);
		expect(status.state).toBe("lagging");
		expect(status.detail).toContain("next Wednesday");
	});

	test("decoder_head is reported and does not affect archive state", () => {
		const status = deriveArchiveStatus(inputs({ decoderHead: 8_745_460 }));
		expect(status.source.decoder_head).toBe(8_745_460);
		expect(status.state).toBe("lagging");
		expect(status.archive.coverage_to_block).toBe(8_745_422);
	});

	test("unreachable decoder_head is null, not a state change", () => {
		const status = deriveArchiveStatus(inputs({ decoderHead: null }));
		expect(status.source.decoder_head).toBe(null);
		expect(status.state).toBe("lagging");
	});

	test("decoder_head defaults to null when omitted", () => {
		const status = deriveArchiveStatus(inputs());
		expect(status.source.decoder_head).toBe(null);
	});

	test("far behind the FINALIZED height is stale", () => {
		// Publishing stopped: the gap is larger than the finality rule explains.
		const status = deriveArchiveStatus(
			inputs({ coverageToBlock: 8_600_000, finalizedHeight: 8_745_422 }),
		);
		expect(status.state).toBe("stale");
		expect(isRestorable(status.state)).toBe(false);
	});

	test("an old promotion is stale even when heights look close", () => {
		// Clock-based staleness catches a publisher that died right after a
		// promotion, where height lag alone would still look acceptable.
		const status = deriveArchiveStatus(
			inputs({ promotedAt: "2026-08-01T00:00:00.000Z" }),
		);
		expect(status.state).toBe("stale");
		expect(status.detail).toContain("freshness objective");
	});

	test("the longest gap in a healthy publish week is NOT stale", () => {
		// The publisher runs Wed + Sun, so a promotion can be four days old with
		// nothing wrong. A threshold below the cadence would report `stale` every
		// single week — the 2026-08-15 page, where the alert was structurally
		// guaranteed rather than describing a real fault.
		const fourDaysBefore = new Date(
			NOW.getTime() - 4 * 24 * 3_600 * 1_000,
		).toISOString();
		const status = deriveArchiveStatus(inputs({ promotedAt: fourDaysBefore }));
		expect(status.state).toBe("lagging");
	});

	test("a missed publish cycle still goes stale", () => {
		// The flip side: the threshold must stay under a full missed cycle, so a
		// skipped run is caught days before the next scheduled attempt.
		const sixDaysBefore = new Date(
			NOW.getTime() - 6 * 24 * 3_600 * 1_000,
		).toISOString();
		const status = deriveArchiveStatus(inputs({ promotedAt: sixDaysBefore }));
		expect(status.state).toBe("stale");
		expect(status.detail).toContain("6d ago");
	});

	test("a failed audit outranks freshness", () => {
		// Current-and-wrong is worse than behind-and-correct.
		const status = deriveArchiveStatus(
			inputs({
				sourceTipHeight: 8_745_422,
				audit: { complete: false, checkedAt: "2026-08-12T06:30:00.000Z" },
			}),
		);
		expect(status.state).toBe("failed-audit");
		expect(status.detail).toContain("not safe to restore");
		expect(isRestorable(status.state)).toBe(false);
	});

	test("no promoted snapshot reports gap", () => {
		const status = deriveArchiveStatus(
			inputs({ snapshotDigest: null, coverageToBlock: null }),
		);
		expect(status.state).toBe("gap");
		expect(isRestorable(status.state)).toBe(false);
	});

	test("an unreachable source reports what is unknown, not health", () => {
		// The archive may be perfectly fine; we cannot currently say so, and
		// guessing "fresh" would be the dishonest answer.
		const status = deriveArchiveStatus(
			inputs({ sourceTipHeight: null, finalizedHeight: null }),
		);
		expect(status.state).toBe("source-unavailable");
		expect(status.detail).toContain("could not be reached");
		expect(status.source.decoder_head).toBe(null);
		expect(isRestorable(status.state)).toBe(false);
	});

	test("source-unavailable still reports a decoder_head when one was read", () => {
		const status = deriveArchiveStatus(
			inputs({
				sourceTipHeight: null,
				finalizedHeight: null,
				decoderHead: 8_745_400,
			}),
		);
		expect(status.state).toBe("source-unavailable");
		expect(status.source.decoder_head).toBe(8_745_400);
	});

	test("the signing key in use is reported, so rotation is visible", () => {
		const status = deriveArchiveStatus(
			inputs({ signingKeyId: "newKeyAfterRotation" }),
		);
		expect(status.archive.signing_key_id).toBe("newKeyAfterRotation");
	});

	test("lag never reports negative when the archive leads the observed tip", () => {
		// A tip read slightly before a promotion lands would otherwise produce a
		// negative lag and a nonsensical status line.
		const status = deriveArchiveStatus(
			inputs({ sourceTipHeight: 8_745_000, finalizedHeight: 8_745_000 }),
		);
		expect(status.lag.blocks_behind_tip).toBe(0);
		expect(status.lag.blocks_behind_finalized).toBe(0);
	});

	test("thresholds are configurable so operators can tighten them", () => {
		const status = deriveArchiveStatus(
			inputs({ coverageToBlock: 8_745_400, maxBlocksBehindFinalized: 10 }),
		);
		expect(status.state).toBe("stale");
	});
});

describe("nextScheduledArchivePublish", () => {
	test("Wednesday after 08:00 UTC fires next Sunday", () => {
		const next = nextScheduledArchivePublish(
			new Date("2026-08-12T12:00:00.000Z"),
		);
		expect(next.toISOString()).toBe("2026-08-16T08:00:00.000Z");
	});

	test("Sunday before 08:00 UTC fires later that morning", () => {
		const next = nextScheduledArchivePublish(
			new Date("2026-08-16T07:59:59.000Z"),
		);
		expect(next.toISOString()).toBe("2026-08-16T08:00:00.000Z");
	});

	test("exactly Sunday 08:00 UTC has already fired, so next is Wednesday", () => {
		const next = nextScheduledArchivePublish(
			new Date("2026-08-16T08:00:00.000Z"),
		);
		expect(next.toISOString()).toBe("2026-08-19T08:00:00.000Z");
	});
});
