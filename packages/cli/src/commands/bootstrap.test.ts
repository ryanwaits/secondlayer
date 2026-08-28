import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ARCHIVE_ROOT_PUBLIC_KEY_PEM } from "@secondlayer/shared/archive/root-key";
import { closeDb, getDb, sql } from "@secondlayer/shared/db";
import { resolveArchivePublicKey } from "../lib/archive-reference.ts";
import {
	type WrittenArchive,
	clearChain,
	digestsFor,
	fixtureChain,
	seedChain,
	writeArchive,
} from "../lib/archive-test-fixture.ts";
import {
	archiveScopeBounds,
	loadOrder,
	parseVerifyDatasets,
} from "./bootstrap.ts";

describe("bootstrap trust root", () => {
	test("a self-hosted instance with no key in env still resolves the compiled archive key", async () => {
		// The exact call bootstrap.ts makes in OSS mode with a bare environment:
		// no --public-key, no ARCHIVE_SIGNING_PUBLIC_KEY, no hosted lookup.
		const key = await resolveArchivePublicKey({
			explicitPem: undefined,
			envPem: undefined,
			allowHostedApi: false,
		});
		expect(key).toBe(ARCHIVE_ROOT_PUBLIC_KEY_PEM);
	});
});

describe("archiveScopeBounds", () => {
	test("start is the archive's lowest partition, not its high-water mark", () => {
		const bounds = archiveScopeBounds([
			{ from_block: 8_200_000, to_block: 8_299_999 },
			{ from_block: 8_000_000, to_block: 8_099_999 },
			{ from_block: 8_100_000, to_block: 8_199_999 },
		]);
		expect(bounds).toEqual({
			start_height: 8_000_000,
			tip_height: 8_299_999,
		});
	});

	test("a genesis-rooted archive starts at zero", () => {
		expect(
			archiveScopeBounds([
				{ from_block: 0, to_block: 99_999 },
				{ from_block: 100_000, to_block: 199_999 },
			]),
		).toEqual({ start_height: 0, tip_height: 199_999 });
	});

	test("interleaved datasets share one pair of bounds", () => {
		// blocks/transactions/events partitions arrive mixed; the bounds are of
		// the restored range, not of any one dataset.
		expect(
			archiveScopeBounds([
				{ from_block: 4_000_000, to_block: 4_099_999 },
				{ from_block: 4_000_000, to_block: 4_099_999 },
				{ from_block: 4_100_000, to_block: 4_199_999 },
			]),
		).toEqual({ start_height: 4_000_000, tip_height: 4_199_999 });
	});

	test("no partitions means no declarable scope", () => {
		expect(archiveScopeBounds([])).toBeNull();
	});
});

describe("bootstrap verification scope", () => {
	test("post-load digests cover blocks, transactions, and events by default and blocks alone on request", () => {
		expect(parseVerifyDatasets(undefined)).toEqual([
			"blocks",
			"transactions",
			"events",
		]);
		expect(parseVerifyDatasets("all")).toEqual([
			"blocks",
			"transactions",
			"events",
		]);
		expect(parseVerifyDatasets("blocks")).toEqual(["blocks"]);
		expect(() => parseVerifyDatasets("tx")).toThrow(/--verify must be/);
	});

	test("the gate sees partitions in load order: every blocks partition before any transactions, then events", () => {
		const interleaved = [
			{ dataset: "events", from_block: 100, to_block: 199, path: "e1" },
			{ dataset: "blocks", from_block: 100, to_block: 199, path: "b1" },
			{ dataset: "transactions", from_block: 0, to_block: 99, path: "t0" },
			{ dataset: "blocks", from_block: 0, to_block: 99, path: "b0" },
			{ dataset: "events", from_block: 0, to_block: 99, path: "e0" },
			{ dataset: "transactions", from_block: 100, to_block: 199, path: "t1" },
		];
		expect(loadOrder(interleaved).map((p) => p.path)).toEqual([
			"b0",
			"b1",
			"t0",
			"t1",
			"e0",
			"e1",
		]);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const CLI_ENTRY = join(import.meta.dir, "../cli.ts");

function runBootstrap(args: string[], publicPem: string) {
	return spawnSync(
		process.execPath,
		[
			CLI_ENTRY,
			"bootstrap",
			"--yes",
			"--json",
			"--public-key",
			publicPem,
			...args,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				NO_COLOR: "1",
				SL_API_URL: "http://127.0.0.1:1",
				STACKS_NODE_RPC_URL: "http://127.0.0.1:1",
			},
		},
	);
}

describe.skipIf(!HAS_DB)("bootstrap against a real database", () => {
	const ranges = [
		{ from_block: 0, to_block: 9 },
		{ from_block: 10, to_block: 19 },
	];
	let archive: WrittenArchive;
	let dir: string;
	const chain = fixtureChain(0, 19);

	beforeAll(async () => {
		const db = getDb();
		dir = await mkdtemp(join(tmpdir(), "sl-bootstrap-db-"));
		await clearChain(db);
		await seedChain(db, chain);
		const digests = await digestsFor(db, ranges);
		archive = await writeArchive(dir, chain, ranges, digests);
	});

	beforeEach(async () => {
		await clearChain(getDb());
	});

	afterAll(async () => {
		await clearChain(getDb());
		await closeDb();
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	test("a forward-only restore verifies only the ranges it loaded and exits 0", async () => {
		const res = runBootstrap(
			["--against", archive.manifestPath, "--from-block", "10"],
			archive.publicPem,
		);
		expect(res.stderr).not.toMatch(/divergent/);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report.status).toBe("restored");
		expect(report.start_height).toBe(10);
		// One range, three datasets. The range below --from-block is scope,
		// not divergence.
		expect(report.ranges_verified).toBe(3);
		expect(report.divergent_ranges).toBe(0);
		const db = getDb();
		const rows = await sql<{
			n: string;
		}>`SELECT COUNT(*)::text AS n FROM events`.execute(db);
		expect(Number(rows.rows[0]?.n)).toBe(10);
	});

	test("a run that died after the blocks pass resumes by loading transactions and events, and verifies all three", async () => {
		const db = getDb();
		await seedChain(db, { ...chain, transactions: [], events: [] });
		const res = runBootstrap(
			["--against", archive.manifestPath],
			archive.publicPem,
		);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report.rows.blocks).toBe(0);
		expect(report.rows.transactions).toBe(20);
		expect(report.rows.events).toBe(20);
		expect(report.ranges_verified).toBe(6);
		expect(report.divergent_ranges).toBe(0);
	});

	test("a run that died inside the events pass reloads only the missing events partition", async () => {
		const db = getDb();
		await seedChain(db, {
			...chain,
			events: chain.events.filter((e) => e.block_height <= 9),
		});
		const res = runBootstrap(
			["--against", archive.manifestPath],
			archive.publicPem,
		);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report.rows).toEqual({ blocks: 0, transactions: 0, events: 10 });
		expect(report.divergent_ranges).toBe(0);
	});

	test("a finished load that never wrote progress is finalized on the next run instead of refused", async () => {
		const db = getDb();
		await seedChain(db, chain);
		const res = runBootstrap(
			["--against", archive.manifestPath],
			archive.publicPem,
		);
		expect(res.status).toBe(0);
		expect(res.stderr).toContain("already loaded");
		const progress = await db
			.selectFrom("index_progress")
			.select("last_indexed_block")
			.executeTakeFirst();
		expect(Number(progress?.last_indexed_block)).toBe(19);
	});

	test("--verify blocks skips the child digests and says so in the report", async () => {
		const res = runBootstrap(
			["--against", archive.manifestPath, "--verify", "blocks"],
			archive.publicPem,
		);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report.verified_datasets).toEqual(["blocks"]);
		expect(report.ranges_verified).toBe(2);
	});
});
