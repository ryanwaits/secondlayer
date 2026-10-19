import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PerHeightDigestRow } from "@secondlayer/shared/archive/per-height-digest";
import { closeDb, getDb } from "@secondlayer/shared/db";
import {
	compareHeights,
	divergentHeightsForRange,
	fetchSidecarRows,
	localPerHeightDigests,
	mergeRepairRanges,
	sidecarNarrows,
	sidecarsCovering,
} from "./archive-heights.ts";
import { loadReference } from "./archive-reference.ts";
import {
	clearChain,
	fixtureChain,
	fixtureHeightRows,
	seedChain,
	writeArchive,
} from "./archive-test-fixture.ts";

const HAS_DB = !!process.env.DATABASE_URL;

function row(
	height: number,
	overrides: Partial<PerHeightDigestRow> = {},
): PerHeightDigestRow {
	return {
		height,
		block_digest: `b${height}`,
		transactions_rollup: `t${height}`,
		events_rollup: `e${height}`,
		...overrides,
	};
}

const covered = [{ from_block: 0, to_block: 9 }];

describe("which datasets the sidecar narrows", () => {
	test("state_writes ranges stay range-level: the sidecar has no state_writes part", async () => {
		expect(sidecarNarrows("blocks")).toBe(true);
		expect(sidecarNarrows("transactions")).toBe(true);
		expect(sidecarNarrows("events")).toBe(true);
		expect(sidecarNarrows("state_writes")).toBe(false);
		// Returns before touching the database or the reference.
		const heights = await divergentHeightsForRange({
			db: undefined as never,
			reference: undefined as never,
			digestIndex: [
				{
					from_block: 0,
					to_block: 9,
					path: "digests/0-9.parquet",
					row_count: 10,
					byte_size: 1,
					sha256: "00",
					digest_spec: "sha256:semantic-v1",
				},
			],
			dataset: "state_writes",
			fromBlock: 0,
			toBlock: 9,
		});
		expect(heights).toBeNull();
	});
});

describe("compareHeights", () => {
	const archive = new Map([0, 1, 2].map((h) => [h, row(h)]));

	test("names only the height whose part differs, and which part", () => {
		const local = new Map(archive);
		local.set(1, row(1, { transactions_rollup: "tampered" }));
		const base = { fromBlock: 0, toBlock: 9, local, archive, covered };
		expect(compareHeights({ ...base, dataset: "transactions" })).toEqual([
			{ height: 1, parts: ["transactions"] },
		]);
		// The same tampering is invisible to the blocks part.
		expect(compareHeights({ ...base, dataset: "blocks" })).toEqual([]);
	});

	test("a height only the archive has is missing-local, and the reverse is missing-archive", () => {
		const local = new Map(archive);
		local.delete(2);
		local.set(3, row(3));
		expect(
			compareHeights({
				dataset: "blocks",
				fromBlock: 0,
				toBlock: 9,
				local,
				archive,
				covered,
			}),
		).toEqual([
			{ height: 2, parts: ["missing-local"] },
			{ height: 3, parts: ["missing-archive"] },
		]);
	});

	test("a local height outside every sidecar's coverage is not called divergent", () => {
		const local = new Map(archive);
		local.set(50, row(50));
		expect(
			compareHeights({
				dataset: "blocks",
				fromBlock: 0,
				toBlock: 99,
				local,
				archive,
				covered,
			}),
		).toEqual([]);
	});

	test("an empty rollup equals an empty rollup", () => {
		const bare = new Map([
			[1, row(1, { transactions_rollup: null, events_rollup: null })],
		]);
		expect(
			compareHeights({
				dataset: "events",
				fromBlock: 0,
				toBlock: 9,
				local: bare,
				archive: bare,
				covered,
			}),
		).toEqual([]);
	});
});

describe("mergeRepairRanges", () => {
	test("overlapping and adjacent ranges across datasets become one span; a gap stays two", () => {
		expect(
			mergeRepairRanges([
				{ from_block: 50_000, to_block: 99_999 },
				{ from_block: 0, to_block: 49_999 },
				{ from_block: 0, to_block: 49_999 },
				{ from_block: 150_000, to_block: 199_999 },
			]),
		).toEqual([
			{ from_block: 0, to_block: 99_999 },
			{ from_block: 150_000, to_block: 199_999 },
		]);
	});
});

describe("sidecars on disk", () => {
	const ranges = [
		{ from_block: 0, to_block: 4 },
		{ from_block: 5, to_block: 9 },
	];
	const chain = fixtureChain(0, 9);
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "sl-heights-"));
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("a sidecar is read from the reference root and matches the rows it was cut from", async () => {
		const archive = await writeArchive(join(dir, "ok"), chain, ranges, [], {
			digestIndex: true,
		});
		const reference = await loadReference(archive.manifestPath, {
			publicKeyPem: archive.publicPem,
		});
		const index = reference.manifest.digest_index as never;
		const covering = sidecarsCovering(index, 6, 7);
		expect(covering.map((p) => p.from_block)).toEqual([5]);
		const rows = await fetchSidecarRows(reference, covering[0] as never);
		expect(rows).toEqual(fixtureHeightRows(chain, ranges[1] as never));
	});

	test("a sidecar whose bytes do not hash to the manifest entry is refused", async () => {
		const archive = await writeArchive(join(dir, "bad"), chain, ranges, [], {
			digestIndex: true,
		});
		const reference = await loadReference(archive.manifestPath, {
			publicKeyPem: archive.publicPem,
		});
		const entry = (
			reference.manifest.digest_index as Array<{ path: string }>
		)[0];
		if (!entry) throw new Error("fixture");
		await writeFile(join(reference.root, entry.path), "tampered");
		await expect(fetchSidecarRows(reference, entry as never)).rejects.toThrow(
			/failed verification/,
		);
	});
});

describe.skipIf(!HAS_DB)("local per-height digests", () => {
	afterAll(async () => {
		await clearChain(getDb());
		await closeDb();
	});

	test("local per-height digests match the exporter's sidecar for the same rows", async () => {
		const range = { from_block: 0, to_block: 9 };
		const chain = fixtureChain(0, 9);
		// A height with two transactions and none of the other parts exercises
		// the rollup ordering and the null rule.
		chain.transactions.push({
			...(chain.transactions[3] as (typeof chain.transactions)[number]),
			tx_id: "tx-3b",
			tx_index: 1,
		});
		chain.events = chain.events.filter((e) => e.block_height !== 7);
		const db = getDb();
		await clearChain(db);
		await seedChain(db, chain);
		const local = await localPerHeightDigests(
			db,
			range.from_block,
			range.to_block,
		);
		expect([...local.values()]).toEqual(fixtureHeightRows(chain, range));
		expect(local.get(7)?.events_rollup).toBeNull();
	});
});
