import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { generateEd25519KeyPair } from "@secondlayer/shared/crypto/ed25519";
import { getDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import { verifyStreamsBulkManifestSignature } from "@secondlayer/shared/streams-bulk-manifest";
import type { Kysely } from "kysely";
import {
	type ColdManifest,
	type ColdS3,
	JOURNAL_RANGE_SIZE,
	alignedRanges,
	coldLocalManifestPath,
	decodeJournalFrames,
	encodeJournalFrame,
	exportJournalRange,
	loadColdJournalBody,
	readColdJournalHeight,
	requireHotWindowHeights,
	verifyJournalRange,
} from "./journal-cold.ts";
import { sha256Hex } from "./observer-journal.ts";
import { persistBlock } from "./persist.ts";

const HAS_DB = !!process.env.DATABASE_URL;
const NETWORK = "journal-cold-test";
const ANCHOR_HEIGHT = 989351;
const HOT_WINDOW = 100;
const BURN_CUTOFF_HEIGHT = 989_000;
const keys = generateEd25519KeyPair();

function fakeBucket() {
	const objects = new Map<string, Buffer>();
	const notFound = () =>
		Object.assign(new Error("not found"), {
			name: "NoSuchKey",
			$metadata: { httpStatusCode: 404 },
		});
	const client = {
		send: async (command: {
			constructor: { name: string };
			input: Record<string, unknown>;
		}) => {
			const key = String(command.input.Key);
			const kind = command.constructor.name;
			if (kind === "HeadObjectCommand") {
				if (!objects.has(key)) throw notFound();
				return {};
			}
			if (kind === "GetObjectCommand") {
				const object = objects.get(key);
				if (!object) throw notFound();
				return { Body: new Uint8Array(object) };
			}
			if (kind === "PutObjectCommand") {
				objects.set(
					key,
					Buffer.from(command.input.Body as Uint8Array | string),
				);
				return {};
			}
			throw new Error(`unexpected command ${kind}`);
		},
	} as unknown as S3Client;
	const s3: ColdS3 = { client, bucket: "bucket" };
	return { s3, objects };
}

type SeedRow = {
	height: number;
	hash: string;
	status?: "processed" | "failed" | "skipped";
	body?: Buffer;
	path?: string;
};

function bodyFor(row: SeedRow): Buffer {
	return (
		row.body ??
		Buffer.from(
			JSON.stringify({ block_hash: row.hash, block_height: row.height }),
		)
	);
}

async function seed(db: Kysely<Database>, rows: SeedRow[]): Promise<void> {
	for (const row of rows) {
		const body = bodyFor(row);
		await db
			.insertInto("observer_journal")
			.values({
				network: NETWORK,
				path: row.path ?? "/new_block",
				source: "test",
				raw_body: body,
				raw_body_sha256: sha256Hex(body),
				status: row.status ?? "processed",
				semantic_sha256: null,
				block_height: row.path === "/new_burn_block" ? null : row.height,
				block_hash: row.path === "/new_burn_block" ? null : row.hash,
				burn_block_height: row.path === "/new_burn_block" ? row.height : 1,
				burn_block_hash: null,
				result: null,
				error: null,
				processed_at: new Date(),
			})
			.execute();
	}
}

async function cleanup(db: Kysely<Database>): Promise<void> {
	await db
		.deleteFrom("observer_journal_cold_ranges")
		.where("network", "=", NETWORK)
		.execute();
	await db
		.deleteFrom("observer_journal")
		.where("network", "=", NETWORK)
		.execute();
	await db
		.deleteFrom("blocks")
		.where("height", "in", [ANCHOR_HEIGHT, BURN_CUTOFF_HEIGHT])
		.execute();
	await db
		.deleteFrom("index_progress")
		.where("network", "=", NETWORK)
		.execute();
}

const NEWLINE_BODY = Buffer.from([
	0x7b, 0x0a, 0x0a, 0x00, 0xff, 0x0a, 0x7d, 0x0a,
]);

const SEEDED: SeedRow[] = [
	{ height: 10, hash: "0xa10" },
	{ height: 11, hash: "0xa11-loser", status: "failed" },
	{ height: 11, hash: "0xa11", body: NEWLINE_BODY },
	{ height: 12, hash: "0xa12", status: "skipped" },
	{ height: 49_999, hash: "0xa49999" },
	{ height: 50_000, hash: "0xb50000" },
];

describe("journal frames", () => {
	test("a body holding newline bytes decodes byte-identical", () => {
		const frame = {
			header: {
				sequence: "7",
				path: "/new_block",
				status: "processed",
				block_height: 3,
				block_hash: "0xh",
				burn_block_height: 1,
				raw_body_sha256: sha256Hex(NEWLINE_BODY),
				body_bytes: NEWLINE_BODY.length,
			},
			body: NEWLINE_BODY,
		};
		const decoded = [
			...decodeJournalFrames(
				Buffer.concat([encodeJournalFrame(frame), encodeJournalFrame(frame)]),
			),
		];
		expect(decoded).toHaveLength(2);
		expect(decoded[1]?.body.equals(NEWLINE_BODY)).toBe(true);
		expect(decoded[1]?.header).toEqual(frame.header);
	});

	test("a file cut inside a body is rejected", () => {
		const body = Buffer.from("abcdef");
		const encoded = encodeJournalFrame({
			header: {
				sequence: "1",
				path: "/new_block",
				status: "processed",
				block_height: 1,
				block_hash: "0x1",
				burn_block_height: 1,
				raw_body_sha256: sha256Hex(body),
				body_bytes: body.length,
			},
			body,
		});
		expect(() => [
			...decodeJournalFrames(encoded.subarray(0, encoded.length - 3)),
		]).toThrow(/truncated/);
	});
});

describe("range arguments", () => {
	test("whole aligned ranges expand one by one", () => {
		expect(alignedRanges(0, JOURNAL_RANGE_SIZE * 2 - 1)).toEqual([
			{ from: 0, to: 49_999 },
			{ from: 50_000, to: 99_999 },
		]);
	});

	test("an unaligned span is refused", () => {
		expect(() => alignedRanges(10, 49_999)).toThrow(/aligned/);
		expect(() => alignedRanges(0, 49_998)).toThrow(/aligned/);
	});

	test("the hot window must be set deliberately", () => {
		expect(() => requireHotWindowHeights({})).toThrow(/JOURNAL_HOT_WINDOW/);
		expect(
			requireHotWindowHeights({ JOURNAL_HOT_WINDOW_HEIGHTS: "250000" }),
		).toBe(250000);
	});
});

describe.skipIf(!HAS_DB)("journal cold tier", () => {
	const db = HAS_DB ? getDb() : (null as never as Kysely<Database>);
	let outDir = "";

	beforeEach(async () => {
		await cleanup(db);
		await persistBlock(db, {
			block: {
				height: ANCHOR_HEIGHT,
				hash: "0xanchor",
				parent_hash: "0xparent",
				burn_block_height: 1,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [],
			evts: [],
			blockHeight: ANCHOR_HEIGHT,
			network: NETWORK,
		});
		outDir = await mkdtemp(join(tmpdir(), "journal-cold-test-"));
	});
	afterEach(async () => {
		await rm(outDir, { recursive: true, force: true });
	});
	afterAll(async () => {
		if (HAS_DB) await cleanup(db);
	});

	function exportRange(
		extra: Partial<Parameters<typeof exportJournalRange>[0]> = {},
	) {
		return exportJournalRange({
			db,
			network: NETWORK,
			kind: "new_block",
			from: 0,
			to: 49_999,
			outDir,
			hotWindowHeights: HOT_WINDOW,
			signingPrivateKeyPem: keys.privateKeyPem,
			...extra,
		});
	}

	test("export writes every row of the range in sequence order, contenders and all statuses", async () => {
		await seed(db, SEEDED);
		const result = await exportRange();

		expect(result.rows).toBe(5);
		const manifest = JSON.parse(
			await readFile(coldLocalManifestPath(result.filePath as string), "utf8"),
		) as ColdManifest;
		expect(manifest.rows).toBe(5);
		expect(
			verifyStreamsBulkManifestSignature(
				manifest as unknown as Record<string, unknown>,
				keys.publicKeyPem,
			),
		).toBe(true);

		const raw = Buffer.from(
			Bun.zstdDecompressSync(await readFile(result.filePath as string)),
		);
		const frames = [...decodeJournalFrames(raw)];
		const sequences = frames.map((frame) => BigInt(frame.header.sequence));
		expect(sequences).toEqual([...sequences].sort((a, b) => (a < b ? -1 : 1)));
		expect(frames.map((frame) => frame.header.block_hash)).toEqual([
			"0xa10",
			"0xa11-loser",
			"0xa11",
			"0xa12",
			"0xa49999",
		]);
		expect(frames.map((frame) => frame.header.status)).toEqual([
			"processed",
			"failed",
			"processed",
			"skipped",
			"processed",
		]);
		expect(frames[2]?.body.equals(NEWLINE_BODY)).toBe(true);
		expect(manifest.min_sequence).toBe(frames[0]?.header.sequence as string);
		expect(manifest.max_sequence).toBe(frames[4]?.header.sequence as string);
	});

	test("a dry run leaves the ledger empty", async () => {
		await seed(db, SEEDED);
		await exportRange();
		const ledger = await db
			.selectFrom("observer_journal_cold_ranges")
			.selectAll()
			.where("network", "=", NETWORK)
			.execute();
		expect(ledger).toEqual([]);
	});

	test("apply without upload is refused", async () => {
		await seed(db, SEEDED);
		await expect(exportRange({ apply: true })).rejects.toThrow(/--upload/);
	});

	test("a range inside the hot window is refused", async () => {
		await seed(db, SEEDED);
		await expect(exportRange({ from: 950_000, to: 999_999 })).rejects.toThrow(
			/hot window/,
		);
	});

	test("an unaligned range is refused", async () => {
		await seed(db, SEEDED);
		await expect(exportRange({ from: 5, to: 50_004 })).rejects.toThrow(
			/aligned/,
		);
	});

	test("upload and apply put signed objects in the bucket and record the range", async () => {
		await seed(db, SEEDED);
		const { s3, objects } = fakeBucket();
		const result = await exportRange({ s3, apply: true });

		expect(result.uploaded).toBe(true);
		expect(result.applied).toBe(true);
		expect([...objects.keys()].sort()).toEqual([
			`observer-journal/${NETWORK}/new_block/0-49999.jf.zst`,
			`observer-journal/${NETWORK}/new_block/0-49999.manifest.json`,
		]);
		const ledger = await db
			.selectFrom("observer_journal_cold_ranges")
			.selectAll()
			.where("network", "=", NETWORK)
			.executeTakeFirstOrThrow();
		expect(Number(ledger.rows)).toBe(5);
		expect(ledger.verified_at).toBeNull();
	});

	test("a rerun after a recorded range skips it", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3, apply: true });
		const again = await exportRange({ s3, apply: true });
		expect(again.status).toBe("already_exported");
	});

	test("an export interrupted before the ledger insert resumes without rewriting the bucket", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3 });
		const resumed = await exportRange({ s3, apply: true });
		expect(resumed.uploaded).toBe(false);
		expect(resumed.applied).toBe(true);
	});

	test("an object already in the bucket with other content is never overwritten", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3 });
		await seed(db, [{ height: 13, hash: "0xa13" }]);
		await expect(exportRange({ s3, apply: true })).rejects.toThrow(
			/refusing to overwrite/,
		);
	});

	test("verify sets verified_at on a clean range", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3, apply: true });
		const result = await verifyJournalRange({
			db,
			network: NETWORK,
			kind: "new_block",
			from: 0,
			publicKeyPem: keys.publicKeyPem,
			s3,
			workDir: outDir,
		});
		expect(result).toEqual({ ok: true, from: 0, to: 49_999, rows: 5 });
		const ledger = await db
			.selectFrom("observer_journal_cold_ranges")
			.select("verified_at")
			.where("network", "=", NETWORK)
			.executeTakeFirstOrThrow();
		expect(ledger.verified_at).not.toBeNull();
	});

	test("verify fails and touches nothing when a file byte is flipped", async () => {
		await seed(db, SEEDED);
		const { s3, objects } = fakeBucket();
		await exportRange({ s3, apply: true });
		const key = `observer-journal/${NETWORK}/new_block/0-49999.jf.zst`;
		const file = Buffer.from(objects.get(key) as Buffer);
		file[Math.floor(file.length / 2)] ^= 0xff;
		objects.set(key, file);

		const result = await verifyJournalRange({
			db,
			network: NETWORK,
			kind: "new_block",
			from: 0,
			publicKeyPem: keys.publicKeyPem,
			s3,
			workDir: outDir,
		});
		expect(result.ok).toBe(false);
		const ledger = await db
			.selectFrom("observer_journal_cold_ranges")
			.select("verified_at")
			.where("network", "=", NETWORK)
			.executeTakeFirstOrThrow();
		expect(ledger.verified_at).toBeNull();
	});

	test("verify fails when a manifest field is edited", async () => {
		await seed(db, SEEDED);
		const { s3, objects } = fakeBucket();
		await exportRange({ s3, apply: true });
		const key = `observer-journal/${NETWORK}/new_block/0-49999.manifest.json`;
		const manifest = JSON.parse(
			(objects.get(key) as Buffer).toString("utf8"),
		) as ColdManifest;
		manifest.rows += 1;
		objects.set(key, Buffer.from(JSON.stringify(manifest)));

		const result = await verifyJournalRange({
			db,
			network: NETWORK,
			kind: "new_block",
			from: 0,
			publicKeyPem: keys.publicKeyPem,
			s3,
			workDir: outDir,
		});
		expect(result).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/signature/),
		});
	});

	test("verify fails when a journal row no longer matches the file", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3, apply: true });
		await db
			.deleteFrom("observer_journal")
			.where("network", "=", NETWORK)
			.where("block_hash", "=", "0xa12")
			.execute();

		const result = await verifyJournalRange({
			db,
			network: NETWORK,
			kind: "new_block",
			from: 0,
			publicKeyPem: keys.publicKeyPem,
			s3,
			workDir: outDir,
		});
		expect(result).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/not in observer_journal/),
		});
	});

	test("a height is read back from the local file by its block hash", async () => {
		await seed(db, SEEDED);
		await exportRange();
		const found = await readColdJournalHeight({
			dir: outDir,
			network: NETWORK,
			kind: "new_block",
			height: 11,
			blockHash: "0xa11",
		});
		expect(found?.body.equals(NEWLINE_BODY)).toBe(true);
		const missing = await readColdJournalHeight({
			dir: outDir,
			network: NETWORK,
			kind: "new_block",
			height: 11,
			blockHash: "0xnope",
		});
		expect(missing).toBeNull();
	});

	test("a redelivered block resolves to its newest journal row", async () => {
		const first = Buffer.from('{"first":true}');
		const second = Buffer.from('{"second":true}');
		await seed(db, [
			{ height: 10, hash: "0xdup", body: first },
			{ height: 10, hash: "0xdup", body: second },
		]);
		await exportRange();
		const found = await readColdJournalHeight({
			dir: outDir,
			network: NETWORK,
			kind: "new_block",
			height: 10,
			blockHash: "0xdup",
		});
		expect(found?.body.equals(second)).toBe(true);
	});

	test("the repair loader falls back from a missing local copy to the bucket", async () => {
		await seed(db, SEEDED);
		const { s3 } = fakeBucket();
		await exportRange({ s3, apply: true });
		const emptyDir = await mkdtemp(join(tmpdir(), "journal-cold-empty-"));
		try {
			const body = await loadColdJournalBody({
				db,
				network: NETWORK,
				height: 11,
				blockHash: "0xa11",
				coldDir: emptyDir,
				s3: () => s3,
			});
			expect(body?.equals(NEWLINE_BODY)).toBe(true);
		} finally {
			await rm(emptyDir, { recursive: true, force: true });
		}
	});

	test("the repair loader returns null for a height no ledger range covers", async () => {
		const body = await loadColdJournalBody({
			db,
			network: NETWORK,
			height: 11,
			blockHash: "0xa11",
		});
		expect(body).toBeNull();
	});

	test("burn block ranges export by burn height", async () => {
		await seed(db, [
			{ height: 5, hash: "unused", path: "/new_burn_block" },
			{ height: 6, hash: "unused", path: "/new_burn_block" },
			{ height: 10, hash: "0xa10" },
		]);
		await persistBlock(db, {
			block: {
				height: BURN_CUTOFF_HEIGHT,
				hash: "0xcutoff",
				parent_hash: "0xparent",
				burn_block_height: 900_000,
				burn_block_hash: null,
				timestamp: 1_700_000_000,
				canonical: true,
			},
			txs: [],
			evts: [],
			blockHeight: BURN_CUTOFF_HEIGHT,
			network: NETWORK,
		});
		const tip = await db
			.selectFrom("blocks")
			.select((eb) => eb.fn.max("height").as("height"))
			.where("canonical", "=", true)
			.executeTakeFirstOrThrow();
		const result = await exportRange({
			kind: "new_burn_block",
			hotWindowHeights: Number(tip.height) - BURN_CUTOFF_HEIGHT,
		});
		expect(result.rows).toBe(2);
	});

	test("an empty range is an error and leaves no file", async () => {
		await expect(exportRange()).rejects.toThrow(/no new_block rows/);
		expect(
			await Bun.file(
				join(outDir, NETWORK, "new_block", "0-49999.jf.zst"),
			).exists(),
		).toBe(false);
	});
});
