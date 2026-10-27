import { describe, expect, test } from "bun:test";
import {
	formatDay,
	formatPublishTime,
	lastPartitions,
	overdueSince,
	readArchiveFreshness,
} from "./archive-freshness";

/** Shape of https://archive.secondlayer.tools/status.json (2026-10-27), plus next_publish_at from the publisher. */
const STATUS = {
	schema_version: 1,
	network: "mainnet",
	generated_at: "2026-10-27T16:00:08.454Z",
	next_publish_at: "2026-10-28T08:00:00.000Z",
	archive: {
		snapshot_digest: "0b7f747f",
		coverage_to_block: 9310507,
		promoted_at: "2026-10-25T10:41:45.785Z",
		signing_key_id: "fHQWzs9ML2WIYakf",
	},
	source: {
		tip_height: 9337361,
		finalized_height: 9337002,
		decoder_head: 9337361,
	},
	lag: { blocks_behind_finalized: 26495, blocks_behind_tip: 26854 },
	state: "lagging",
};

describe("readArchiveFreshness", () => {
	test("reads a real status body", () => {
		expect(readArchiveFreshness(STATUS)).toEqual({
			toBlock: 9310507,
			promotedAt: "2026-10-25T10:41:45.785Z",
			state: "lagging",
			nextPublishAt: "2026-10-28T08:00:00.000Z",
			behindTip: 26854,
		});
	});

	test("next_publish_at is null before the publisher emits it", () => {
		const { next_publish_at: _, ...old } = STATUS;
		expect(readArchiveFreshness(old)?.nextPublishAt).toBeNull();
	});

	test("is null on junk or a body missing coverage", () => {
		expect(readArchiveFreshness(null)).toBeNull();
		expect(readArchiveFreshness({ state: "fresh" })).toBeNull();
		expect(
			readArchiveFreshness({ ...STATUS, archive: { coverage_to_block: "9" } }),
		).toBeNull();
	});
});

describe("overdueSince", () => {
	test("is the first scheduled run after the promotion", () => {
		// Sat Oct 10 -> Sun Oct 11 08:00 UTC
		expect(overdueSince("2026-10-10T12:00:00.000Z")).toBe(
			"2026-10-11T08:00:00.000Z",
		);
		// promoted before the Sunday run -> that same day
		expect(overdueSince("2026-10-25T01:00:00.000Z")).toBe(
			"2026-10-25T08:00:00.000Z",
		);
	});
});

describe("formatting", () => {
	test("publish time is UTC with weekday", () => {
		expect(formatPublishTime("2026-10-18T08:00:00.000Z")).toBe(
			"Sun Oct 18, 08:00 UTC",
		);
	});
	test("day ignores the host zone", () => {
		expect(formatDay("2026-10-07T23:59:00.000Z")).toBe("Oct 7");
	});
});

describe("lastPartitions", () => {
	const part = (dataset: string, from: number, to: number, sha: string) => ({
		dataset,
		from_block: from,
		to_block: to,
		sha256: sha,
	});
	test("picks the highest to_block per dataset and ignores other datasets", () => {
		const names = lastPartitions({
			partitions: [
				part("blocks", 0, 9, "aaaa1111"),
				part("blocks", 10, 19, "bbbb2222"),
				part("transactions", 10, 19, "cccc3333"),
				part("events", 10, 19, "dddd4444"),
				part("events", 0, 9, "eeee5555"),
				part("state_writes", 10, 99, "ffff6666"),
			],
		});
		expect(names).toEqual({
			blocks: "10-19-bbbb….parquet",
			transactions: "10-19-cccc….parquet",
			events: "10-19-dddd….parquet",
		});
	});
	test("is null when a dataset is missing or the body is junk", () => {
		expect(
			lastPartitions({ partitions: [part("blocks", 0, 9, "aaaa")] }),
		).toBeNull();
		expect(lastPartitions(null)).toBeNull();
		expect(lastPartitions({})).toBeNull();
	});
});
