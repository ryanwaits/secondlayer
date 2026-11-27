#!/usr/bin/env bun
/**
 * Move old `observer_journal` bodies into signed zstd files on R2.
 *
 * One file per aligned 50,000-height range, every row of the range in sequence
 * order (all statuses, all fork contenders). Layout "journal-frame-v1": a run
 * of frames, each a JSON header line, exactly `body_bytes` raw `raw_body`
 * bytes, then a newline. Frames are cut into zstd chunks of about 64 MiB and
 * the chunks are concatenated, so the file is also a plain zstd stream
 * (`zstd -d`). The signed manifest lists every chunk, so readers decompress
 * one chunk at a time.
 *
 * Export and verify never delete anything. The Postgres delete is a
 * founder-gated runbook step.
 *
 * Usage:
 *   bun run packages/indexer/src/journal-cold.ts export --network mainnet --kind new_block --from 0 --to 49999 --out /var/tmp/journal-cold
 *   bun run packages/indexer/src/journal-cold.ts export --network mainnet --kind new_block --from 0 --to 99999 --out /var/tmp/journal-cold --upload --apply
 *   bun run packages/indexer/src/journal-cold.ts verify --network mainnet --kind new_block --from 0 --to 99999
 *
 * Environment: JOURNAL_HOT_WINDOW_HEIGHTS (export, required), STREAMS_SIGNING_PRIVATE_KEY
 * (export), STREAMS_SIGNING_PUBLIC_KEY or the private key (verify),
 * STREAMS_BULK_R2_* (upload, verify). `--from`/`--to` span whole aligned ranges;
 * ranges already in the ledger are skipped on export.
 *
 * Dry-run by default: without `--upload` the files are only written under
 * `--out`; `--apply` (which needs `--upload`) records the ledger row.
 */
import { createHash } from "node:crypto";
import { type FileHandle, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { publicKeyPemFromPrivate } from "@secondlayer/shared/crypto/ed25519";
import { closeDb, getSourceDb } from "@secondlayer/shared/db";
import type { Database } from "@secondlayer/shared/db/schema";
import {
	signStreamsBulkManifest,
	verifyStreamsBulkManifestSignature,
} from "@secondlayer/shared/streams-bulk-manifest";
import type { Kysely } from "kysely";
import { sha256Hex } from "./observer-journal.ts";
import {
	createStreamsBulkS3Client,
	getJsonObject,
	getObjectBuffer,
	getStreamsBulkR2ConfigFromEnv,
	objectExists,
	putFileObject,
	putJsonObject,
} from "./streams-bulk/upload.ts";

export const JOURNAL_RANGE_SIZE = 50_000;
export const JOURNAL_COLD_FORMAT = "journal-frame-v1";
const SCAN_PAGE = 1000;
const HEIGHT_SLACK = 1000;
const BODY_BATCH = 100;
const VERIFY_BATCH = 500;
const CHUNK_RAW_BYTES = 64 * 1024 * 1024;
const NEWLINE = 0x0a;

export type JournalColdKind = "new_block" | "new_burn_block";

const KIND_PATH: Record<JournalColdKind, string> = {
	new_block: "/new_block",
	new_burn_block: "/new_burn_block",
};

const KIND_HEIGHT_COLUMN = {
	new_block: "block_height",
	new_burn_block: "burn_block_height",
} as const;

export type JournalFrameHeader = {
	sequence: string;
	path: string;
	status: string;
	block_height: number | null;
	block_hash: string | null;
	burn_block_height: number | null;
	raw_body_sha256: string;
	body_bytes: number;
};

export type JournalFrame = { header: JournalFrameHeader; body: Buffer };

export type ColdChunk = {
	rows: number;
	raw_bytes: number;
	compressed_bytes: number;
	min_height: number | null;
	max_height: number | null;
};

export type ColdManifest = {
	format: typeof JOURNAL_COLD_FORMAT;
	network: string;
	kind: JournalColdKind;
	from_height: number;
	to_height: number;
	rows: number;
	min_sequence: string;
	max_sequence: string;
	object_key: string;
	file_sha256: string;
	file_bytes: number;
	raw_body_sha256_rollup: string;
	chunks: ColdChunk[];
	signature?: string;
	key_id?: string;
};

export type ColdS3 = { client: S3Client; bucket: string };

export function coldObjectKey(
	network: string,
	kind: JournalColdKind,
	from: number,
	to: number,
): string {
	return `observer-journal/${network}/${kind}/${from}-${to}.jf.zst`;
}

export function coldManifestKey(objectKey: string): string {
	return objectKey.replace(/\.jf\.zst$/, ".manifest.json");
}

export function coldRangeStart(height: number): number {
	return height - (height % JOURNAL_RANGE_SIZE);
}

export function coldLocalPath(
	dir: string,
	network: string,
	kind: JournalColdKind,
	from: number,
): string {
	return join(
		dir,
		network,
		kind,
		`${from}-${from + JOURNAL_RANGE_SIZE - 1}.jf.zst`,
	);
}

export function coldLocalManifestPath(filePath: string): string {
	return coldManifestKey(filePath);
}

export function encodeJournalFrame(frame: JournalFrame): Buffer {
	return Buffer.concat([
		Buffer.from(`${JSON.stringify(frame.header)}\n`, "utf8"),
		frame.body,
		Buffer.from([NEWLINE]),
	]);
}

export function* decodeJournalFrames(raw: Uint8Array): Generator<JournalFrame> {
	const buffer = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
	let offset = 0;
	while (offset < buffer.length) {
		const eol = buffer.indexOf(NEWLINE, offset);
		if (eol < 0) throw new Error("journal frame: truncated header");
		const header = JSON.parse(
			buffer.toString("utf8", offset, eol),
		) as JournalFrameHeader;
		const start = eol + 1;
		const end = start + header.body_bytes;
		if (end >= buffer.length || buffer[end] !== NEWLINE) {
			throw new Error(`journal frame ${header.sequence}: truncated body`);
		}
		yield { header, body: buffer.subarray(start, end) };
		offset = end + 1;
	}
}

function frameHeight(
	header: JournalFrameHeader,
	kind: JournalColdKind,
): number | null {
	return kind === "new_block" ? header.block_height : header.burn_block_height;
}

class ChunkedFrameWriter {
	readonly chunks: ColdChunk[] = [];
	fileBytes = 0;
	private readonly hash = createHash("sha256");
	private pending: Buffer[] = [];
	private pendingBytes = 0;
	private pendingRows = 0;
	private pendingMin: number | null = null;
	private pendingMax: number | null = null;

	constructor(
		private readonly handle: FileHandle,
		private readonly kind: JournalColdKind,
	) {}

	async add(frame: JournalFrame): Promise<void> {
		const encoded = encodeJournalFrame(frame);
		this.pending.push(encoded);
		this.pendingBytes += encoded.length;
		this.pendingRows += 1;
		const height = frameHeight(frame.header, this.kind);
		if (height !== null) {
			this.pendingMin =
				this.pendingMin === null ? height : Math.min(this.pendingMin, height);
			this.pendingMax =
				this.pendingMax === null ? height : Math.max(this.pendingMax, height);
		}
		if (this.pendingBytes >= CHUNK_RAW_BYTES) await this.flush();
	}

	async flush(): Promise<void> {
		if (this.pendingRows === 0) return;
		const compressed = Buffer.from(
			Bun.zstdCompressSync(Buffer.concat(this.pending), { level: 9 }),
		);
		await this.handle.write(compressed);
		this.hash.update(compressed);
		this.fileBytes += compressed.length;
		this.chunks.push({
			rows: this.pendingRows,
			raw_bytes: this.pendingBytes,
			compressed_bytes: compressed.length,
			min_height: this.pendingMin,
			max_height: this.pendingMax,
		});
		this.pending = [];
		this.pendingBytes = 0;
		this.pendingRows = 0;
		this.pendingMin = null;
		this.pendingMax = null;
	}

	async finish(): Promise<{ sha256: string }> {
		await this.flush();
		return { sha256: this.hash.digest("hex") };
	}
}

function nullableHeight(value: number | string | null): number | null {
	return value === null ? null : Number(value);
}

type ScannedRow = { sequence: string; height: number };

async function* scanRangeRows(
	db: Kysely<Database>,
	params: {
		network: string;
		kind: JournalColdKind;
		from: number;
		to: number;
		afterSequence: string;
	},
): AsyncGenerator<ScannedRow[]> {
	const column = KIND_HEIGHT_COLUMN[params.kind];
	let after = params.afterSequence;
	for (;;) {
		const page = await db
			.selectFrom("observer_journal")
			.select(["sequence", column])
			.where("network", "=", params.network)
			.where("path", "=", KIND_PATH[params.kind])
			.where("sequence", ">", after)
			.orderBy("sequence")
			.limit(SCAN_PAGE)
			.execute();
		const last = page.at(-1);
		if (!last) return;
		after = last.sequence;
		const heights = page.flatMap((row) => {
			const height = nullableHeight(row[column]);
			return height === null ? [] : [{ sequence: row.sequence, height }];
		});
		const inRange = heights.filter(
			(row) => row.height >= params.from && row.height <= params.to,
		);
		if (inRange.length > 0) yield inRange;
		const minHeight = Math.min(...heights.map((row) => row.height));
		if (heights.length > 0 && minHeight > params.to + HEIGHT_SLACK) return;
	}
}

async function loadFrames(
	db: Kysely<Database>,
	sequences: string[],
): Promise<JournalFrame[]> {
	const rows = await db
		.selectFrom("observer_journal")
		.select([
			"sequence",
			"path",
			"status",
			"block_height",
			"block_hash",
			"burn_block_height",
			"raw_body_sha256",
			"raw_body",
		])
		.where("sequence", "in", sequences)
		.orderBy("sequence")
		.execute();
	return rows.map((row) => ({
		header: {
			sequence: row.sequence,
			path: row.path,
			status: row.status,
			block_height: nullableHeight(row.block_height),
			block_hash: row.block_hash,
			burn_block_height: nullableHeight(row.burn_block_height),
			raw_body_sha256: row.raw_body_sha256,
			body_bytes: row.raw_body.length,
		},
		body: row.raw_body,
	}));
}

export function assertAlignedRange(from: number, to: number): void {
	if (
		!Number.isSafeInteger(from) ||
		from < 0 ||
		from % JOURNAL_RANGE_SIZE !== 0 ||
		to !== from + JOURNAL_RANGE_SIZE - 1
	) {
		throw new Error(
			`journal-cold: range ${from}-${to} is not an aligned ${JOURNAL_RANGE_SIZE}-height range`,
		);
	}
}

export function alignedRanges(
	from: number,
	to: number,
): Array<{ from: number; to: number }> {
	if (
		!Number.isSafeInteger(from) ||
		!Number.isSafeInteger(to) ||
		from < 0 ||
		from % JOURNAL_RANGE_SIZE !== 0 ||
		(to + 1) % JOURNAL_RANGE_SIZE !== 0 ||
		to < from
	) {
		throw new Error(
			`journal-cold: --from must be a multiple of ${JOURNAL_RANGE_SIZE} and --to must end an aligned range (from ${from}, to ${to})`,
		);
	}
	const ranges: Array<{ from: number; to: number }> = [];
	for (let start = from; start < to; start += JOURNAL_RANGE_SIZE) {
		ranges.push({ from: start, to: start + JOURNAL_RANGE_SIZE - 1 });
	}
	return ranges;
}

export function requireHotWindowHeights(
	env: Record<string, string | undefined> = process.env,
): number {
	const raw = env.JOURNAL_HOT_WINDOW_HEIGHTS;
	const value = Number(raw);
	if (!raw || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(
			"journal-cold: JOURNAL_HOT_WINDOW_HEIGHTS must be set to a positive integer",
		);
	}
	return value;
}

export async function assertOutsideHotWindow(
	db: Kysely<Database>,
	kind: JournalColdKind,
	to: number,
	hotWindowHeights: number,
): Promise<void> {
	const tip = await db
		.selectFrom("blocks")
		.select((eb) => eb.fn.max("height").as("height"))
		.where("canonical", "=", true)
		.executeTakeFirst();
	if (tip?.height === null || tip?.height === undefined) {
		throw new Error(
			"journal-cold: no canonical blocks to anchor the hot window",
		);
	}
	const cutoffHeight = Number(tip.height) - hotWindowHeights;
	if (kind === "new_block") {
		if (to > cutoffHeight) {
			throw new Error(
				`journal-cold: range ending ${to} is inside the hot window (newest exportable height ${cutoffHeight})`,
			);
		}
		return;
	}
	const anchor = await db
		.selectFrom("blocks")
		.select("burn_block_height")
		.where("height", "<=", cutoffHeight)
		.where("canonical", "=", true)
		.orderBy("height", "desc")
		.limit(1)
		.executeTakeFirst();
	if (!anchor || Number(anchor.burn_block_height) < to) {
		throw new Error(
			`journal-cold: burn range ending ${to} is inside the hot window (newest exportable burn height ${anchor?.burn_block_height ?? "unknown"})`,
		);
	}
}

export type ExportRangeResult = {
	status: "exported" | "already_exported";
	from: number;
	to: number;
	rows: number;
	rawBytes: number;
	compressedBytes: number;
	seconds: number;
	uploaded: boolean;
	applied: boolean;
	filePath: string | null;
	manifest: ColdManifest | null;
};

export type ExportRangeOptions = {
	db: Kysely<Database>;
	network: string;
	kind: JournalColdKind;
	from: number;
	to: number;
	outDir: string;
	hotWindowHeights: number;
	signingPrivateKeyPem: string;
	s3?: ColdS3;
	apply?: boolean;
};

async function ledgerRow(
	db: Kysely<Database>,
	network: string,
	kind: JournalColdKind,
	from: number,
) {
	return db
		.selectFrom("observer_journal_cold_ranges")
		.selectAll()
		.where("network", "=", network)
		.where("kind", "=", kind)
		.where("from_height", "=", String(from))
		.executeTakeFirst();
}

async function scanStartSequence(
	db: Kysely<Database>,
	network: string,
	kind: JournalColdKind,
	from: number,
): Promise<string> {
	const previous = await db
		.selectFrom("observer_journal_cold_ranges")
		.select("min_sequence")
		.where("network", "=", network)
		.where("kind", "=", kind)
		.where("to_height", "<", String(from))
		.orderBy("from_height", "desc")
		.limit(1)
		.executeTakeFirst();
	return previous?.min_sequence ?? "0";
}

export async function exportJournalRange(
	options: ExportRangeOptions,
): Promise<ExportRangeResult> {
	const { db, network, kind, from, to } = options;
	const started = performance.now();
	assertAlignedRange(from, to);
	if (options.apply && !options.s3) {
		throw new Error("journal-cold: --apply needs --upload");
	}
	await assertOutsideHotWindow(db, kind, to, options.hotWindowHeights);

	const existing = await ledgerRow(db, network, kind, from);
	if (existing) {
		return {
			status: "already_exported",
			from,
			to,
			rows: Number(existing.rows),
			rawBytes: 0,
			compressedBytes: 0,
			seconds: 0,
			uploaded: false,
			applied: false,
			filePath: null,
			manifest: null,
		};
	}

	const filePath = coldLocalPath(options.outDir, network, kind, from);
	await mkdir(join(options.outDir, network, kind), { recursive: true });
	const handle = await open(filePath, "w");
	const writer = new ChunkedFrameWriter(handle, kind);
	const rollup = createHash("sha256");
	let rows = 0;
	let minSequence: string | null = null;
	let maxSequence: string | null = null;
	let sha256: string;
	try {
		const scan = scanRangeRows(db, {
			network,
			kind,
			from,
			to,
			afterSequence: await scanStartSequence(db, network, kind, from),
		});
		for await (const page of scan) {
			for (let i = 0; i < page.length; i += BODY_BATCH) {
				const batch = page.slice(i, i + BODY_BATCH);
				const frames = await loadFrames(
					db,
					batch.map((row) => row.sequence),
				);
				for (const frame of frames) {
					if (sha256Hex(frame.body) !== frame.header.raw_body_sha256) {
						throw new Error(
							`journal-cold: row ${frame.header.sequence} body does not match its stored sha256`,
						);
					}
					await writer.add(frame);
					if (rows > 0) rollup.update("\n");
					rollup.update(frame.header.raw_body_sha256);
					rows += 1;
					minSequence ??= frame.header.sequence;
					maxSequence = frame.header.sequence;
				}
			}
		}
		sha256 = (await writer.finish()).sha256;
	} catch (error) {
		await handle.close();
		await rm(filePath, { force: true });
		throw error;
	}
	await handle.close();

	if (rows === 0 || minSequence === null || maxSequence === null) {
		await rm(filePath, { force: true });
		throw new Error(
			`journal-cold: no ${kind} rows for ${network} heights ${from}-${to}`,
		);
	}

	const objectKey = coldObjectKey(network, kind, from, to);
	const manifest = signStreamsBulkManifest(
		{
			format: JOURNAL_COLD_FORMAT,
			network,
			kind,
			from_height: from,
			to_height: to,
			rows,
			min_sequence: minSequence,
			max_sequence: maxSequence,
			object_key: objectKey,
			file_sha256: sha256,
			file_bytes: writer.fileBytes,
			raw_body_sha256_rollup: rollup.digest("hex"),
			chunks: writer.chunks,
		} satisfies ColdManifest,
		options.signingPrivateKeyPem,
	);
	await Bun.write(
		coldLocalManifestPath(filePath),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	let uploaded = false;
	let applied = false;
	if (options.s3) {
		uploaded = await uploadRange(options.s3, filePath, manifest);
		if (options.apply) {
			await db
				.insertInto("observer_journal_cold_ranges")
				.values({
					network,
					kind,
					from_height: from,
					to_height: to,
					rows,
					min_sequence: minSequence,
					max_sequence: maxSequence,
					object_key: objectKey,
					file_sha256: sha256,
					manifest_key: coldManifestKey(objectKey),
					verified_at: null,
				})
				.execute();
			applied = true;
		}
	}

	return {
		status: "exported",
		from,
		to,
		rows,
		rawBytes: writer.chunks.reduce((sum, chunk) => sum + chunk.raw_bytes, 0),
		compressedBytes: writer.fileBytes,
		seconds: (performance.now() - started) / 1000,
		uploaded,
		applied,
		filePath,
		manifest,
	};
}

async function uploadRange(
	s3: ColdS3,
	filePath: string,
	manifest: ColdManifest,
): Promise<boolean> {
	const manifestKey = coldManifestKey(manifest.object_key);
	const remote = await getJsonObject<ColdManifest>({
		client: s3.client,
		bucket: s3.bucket,
		key: manifestKey,
	});
	if (remote) {
		if (
			remote.file_sha256 !== manifest.file_sha256 ||
			remote.rows !== manifest.rows
		) {
			throw new Error(
				`journal-cold: ${manifest.object_key} already exists with different content; refusing to overwrite`,
			);
		}
		return false;
	}
	if (
		await objectExists({
			client: s3.client,
			bucket: s3.bucket,
			key: manifest.object_key,
		})
	) {
		throw new Error(
			`journal-cold: ${manifest.object_key} already exists without a manifest; refusing to overwrite`,
		);
	}
	await putFileObject({
		client: s3.client,
		bucket: s3.bucket,
		key: manifest.object_key,
		path: filePath,
		contentType: "application/zstd",
	});
	await putJsonObject({
		client: s3.client,
		bucket: s3.bucket,
		key: manifestKey,
		value: manifest,
	});
	return true;
}

async function* readChunks(
	filePath: string,
	manifest: ColdManifest,
	wanted?: (chunk: ColdChunk) => boolean,
): AsyncGenerator<{ chunk: ColdChunk; raw: Buffer }> {
	const handle = await open(filePath, "r");
	try {
		let offset = 0;
		for (const chunk of manifest.chunks) {
			const start = offset;
			offset += chunk.compressed_bytes;
			if (wanted && !wanted(chunk)) continue;
			const compressed = Buffer.alloc(chunk.compressed_bytes);
			const { bytesRead } = await handle.read(
				compressed,
				0,
				chunk.compressed_bytes,
				start,
			);
			if (bytesRead !== chunk.compressed_bytes) {
				throw new Error("journal-cold: file is shorter than its manifest");
			}
			const raw = Buffer.from(Bun.zstdDecompressSync(compressed));
			if (raw.length !== chunk.raw_bytes) {
				throw new Error("journal-cold: chunk size does not match its manifest");
			}
			yield { chunk, raw };
		}
	} finally {
		await handle.close();
	}
}

export async function readColdJournalHeight(params: {
	dir: string;
	network: string;
	kind: JournalColdKind;
	height: number;
	blockHash: string;
}): Promise<{ body: Buffer; sequence: string } | null> {
	const filePath = coldLocalPath(
		params.dir,
		params.network,
		params.kind,
		coldRangeStart(params.height),
	);
	const manifestFile = Bun.file(coldLocalManifestPath(filePath));
	if (!(await manifestFile.exists()) || !(await Bun.file(filePath).exists())) {
		return null;
	}
	const manifest = (await manifestFile.json()) as ColdManifest;
	let found: { body: Buffer; sequence: string } | null = null;
	const chunks = readChunks(
		filePath,
		manifest,
		(chunk) =>
			chunk.min_height !== null &&
			chunk.max_height !== null &&
			chunk.min_height <= params.height &&
			params.height <= chunk.max_height,
	);
	for await (const { raw } of chunks) {
		for (const frame of decodeJournalFrames(raw)) {
			if (
				frameHeight(frame.header, params.kind) !== params.height ||
				frame.header.block_hash !== params.blockHash
			) {
				continue;
			}
			if (sha256Hex(frame.body) !== frame.header.raw_body_sha256) {
				throw new Error(
					`journal-cold: frame ${frame.header.sequence} fails its sha256 in ${filePath}`,
				);
			}
			found = {
				body: Buffer.from(frame.body),
				sequence: frame.header.sequence,
			};
		}
	}
	return found;
}

export function coldS3FromEnv(): ColdS3 {
	const config = getStreamsBulkR2ConfigFromEnv();
	return { client: createStreamsBulkS3Client(config), bucket: config.bucket };
}

export async function downloadColdRange(params: {
	s3: ColdS3;
	objectKey: string;
	dir: string;
	network: string;
	kind: JournalColdKind;
	from: number;
}): Promise<{ filePath: string; sha256: string; bytes: number }> {
	const filePath = coldLocalPath(
		params.dir,
		params.network,
		params.kind,
		params.from,
	);
	await mkdir(join(params.dir, params.network, params.kind), {
		recursive: true,
	});
	const response = await params.s3.client.send(
		new GetObjectCommand({ Bucket: params.s3.bucket, Key: params.objectKey }),
	);
	const body: unknown = response.Body;
	if (!body) throw new Error(`empty object body: ${params.objectKey}`);
	const hash = createHash("sha256");
	let bytes = 0;
	const handle = await open(filePath, "w");
	try {
		const write = async (chunk: Uint8Array) => {
			hash.update(chunk);
			bytes += chunk.length;
			await handle.write(chunk);
		};
		if (body instanceof Uint8Array) {
			await write(body);
		} else if (typeof body === "object" && Symbol.asyncIterator in body) {
			for await (const chunk of body as AsyncIterable<Uint8Array>) {
				await write(chunk);
			}
		} else if (
			typeof body === "object" &&
			"transformToByteArray" in body &&
			typeof body.transformToByteArray === "function"
		) {
			await write(await body.transformToByteArray());
		} else {
			throw new Error("unsupported S3 object body");
		}
	} finally {
		await handle.close();
	}
	const manifestBuffer = await getObjectBuffer({
		client: params.s3.client,
		bucket: params.s3.bucket,
		key: coldManifestKey(params.objectKey),
	});
	await Bun.write(coldLocalManifestPath(filePath), manifestBuffer);
	return { filePath, sha256: hash.digest("hex"), bytes };
}

export type VerifyRangeResult =
	| { ok: true; from: number; to: number; rows: number }
	| { ok: false; from: number; to: number; reason: string };

export async function verifyJournalRange(params: {
	db: Kysely<Database>;
	network: string;
	kind: JournalColdKind;
	from: number;
	publicKeyPem: string;
	s3: ColdS3;
	workDir: string;
}): Promise<VerifyRangeResult> {
	const { db, network, kind, from } = params;
	const to = from + JOURNAL_RANGE_SIZE - 1;
	const fail = (reason: string): VerifyRangeResult => ({
		ok: false,
		from,
		to,
		reason,
	});
	assertAlignedRange(from, to);

	const ledger = await ledgerRow(db, network, kind, from);
	if (!ledger) return fail("no ledger row for this range");

	const manifest = await getJsonObject<ColdManifest>({
		client: params.s3.client,
		bucket: params.s3.bucket,
		key: ledger.manifest_key,
	});
	if (!manifest) return fail("manifest missing from R2");
	if (
		!verifyStreamsBulkManifestSignature(
			manifest as unknown as Record<string, unknown>,
			params.publicKeyPem,
		)
	) {
		return fail("manifest signature does not verify");
	}
	if (
		manifest.format !== JOURNAL_COLD_FORMAT ||
		manifest.network !== network ||
		manifest.kind !== kind ||
		manifest.from_height !== from ||
		manifest.to_height !== to ||
		manifest.object_key !== ledger.object_key ||
		manifest.file_sha256 !== ledger.file_sha256 ||
		String(manifest.rows) !== String(ledger.rows) ||
		manifest.min_sequence !== ledger.min_sequence ||
		manifest.max_sequence !== ledger.max_sequence
	) {
		return fail("manifest does not match the ledger row");
	}

	const dir = await mkdtemp(join(params.workDir, "verify-"));
	try {
		const downloaded = await downloadColdRange({
			s3: params.s3,
			objectKey: manifest.object_key,
			dir,
			network,
			kind,
			from,
		});
		if (
			downloaded.sha256 !== manifest.file_sha256 ||
			downloaded.bytes !== manifest.file_bytes
		) {
			return fail("downloaded file does not match file_sha256");
		}

		const rollup = createHash("sha256");
		let rows = 0;
		let firstSequence: string | null = null;
		let lastSequence: string | null = null;
		let pending: JournalFrameHeader[] = [];

		const checkAgainstDb = async (): Promise<string | null> => {
			const batch = pending;
			pending = [];
			if (batch.length === 0) return null;
			const stored = await db
				.selectFrom("observer_journal")
				.select(["sequence", "raw_body_sha256"])
				.where(
					"sequence",
					"in",
					batch.map((header) => header.sequence),
				)
				.execute();
			const bySequence = new Map(
				stored.map((row) => [row.sequence, row.raw_body_sha256]),
			);
			for (const header of batch) {
				const dbSha = bySequence.get(header.sequence);
				if (dbSha === undefined) {
					return `row ${header.sequence} is not in observer_journal`;
				}
				if (dbSha !== header.raw_body_sha256) {
					return `row ${header.sequence} differs from observer_journal`;
				}
			}
			return null;
		};

		for await (const { chunk, raw } of readChunks(
			downloaded.filePath,
			manifest,
		)) {
			let chunkRows = 0;
			for (const frame of decodeJournalFrames(raw)) {
				if (sha256Hex(frame.body) !== frame.header.raw_body_sha256) {
					return fail(`frame ${frame.header.sequence} fails its sha256`);
				}
				if (rows > 0) rollup.update("\n");
				rollup.update(frame.header.raw_body_sha256);
				rows += 1;
				chunkRows += 1;
				firstSequence ??= frame.header.sequence;
				lastSequence = frame.header.sequence;
				pending.push(frame.header);
				if (pending.length >= VERIFY_BATCH) {
					const mismatch = await checkAgainstDb();
					if (mismatch) return fail(mismatch);
				}
			}
			if (chunkRows !== chunk.rows) {
				return fail("chunk row count does not match the manifest");
			}
		}
		const mismatch = await checkAgainstDb();
		if (mismatch) return fail(mismatch);

		if (rows !== manifest.rows) return fail("row count does not match");
		if (
			firstSequence !== manifest.min_sequence ||
			lastSequence !== manifest.max_sequence
		) {
			return fail("sequence bounds do not match");
		}
		if (rollup.digest("hex") !== manifest.raw_body_sha256_rollup) {
			return fail("raw_body_sha256 rollup does not match");
		}

		await db
			.updateTable("observer_journal_cold_ranges")
			.set({ verified_at: new Date() })
			.where("network", "=", network)
			.where("kind", "=", kind)
			.where("from_height", "=", String(from))
			.execute();
		return { ok: true, from, to, rows };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function loadColdJournalBody(params: {
	db: Kysely<Database>;
	network: string;
	height: number;
	blockHash: string;
	coldDir?: string;
	s3?: () => ColdS3;
}): Promise<Buffer | null> {
	const { db, network, height } = params;
	const range = await db
		.selectFrom("observer_journal_cold_ranges")
		.select(["from_height", "object_key"])
		.where("network", "=", network)
		.where("kind", "=", "new_block")
		.where("from_height", "<=", String(height))
		.where("to_height", ">=", String(height))
		.executeTakeFirst();
	if (!range) return null;

	const read = (dir: string) =>
		readColdJournalHeight({
			dir,
			network,
			kind: "new_block",
			height,
			blockHash: params.blockHash,
		});
	if (params.coldDir) {
		const local = await read(params.coldDir);
		if (local) return local.body;
	}
	if (!params.s3) return null;

	const scratch = await mkdtemp(
		join(process.env.TMPDIR ?? "/tmp", "journal-cold-"),
	);
	try {
		await downloadColdRange({
			s3: params.s3(),
			objectKey: range.object_key,
			dir: scratch,
			network,
			kind: "new_block",
			from: Number(range.from_height),
		});
		return (await read(scratch))?.body ?? null;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

function resolvePublicKeyPem(): string {
	const explicit = process.env.STREAMS_SIGNING_PUBLIC_KEY;
	if (explicit) return explicit.replace(/\\n/g, "\n");
	const privateKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	if (!privateKey) {
		throw new Error(
			"journal-cold: STREAMS_SIGNING_PUBLIC_KEY or STREAMS_SIGNING_PRIVATE_KEY is required",
		);
	}
	return publicKeyPemFromPrivate(privateKey.replace(/\\n/g, "\n"));
}

type CliArgs = {
	command: "export" | "verify";
	network: string;
	kind: JournalColdKind;
	from: number;
	to: number;
	out: string | undefined;
	upload: boolean;
	apply: boolean;
};

function parseArgs(argv: string[]): CliArgs {
	const [command, ...rest] = argv;
	if (command !== "export" && command !== "verify") {
		throw new Error("usage: journal-cold.ts <export|verify> [options]");
	}
	let network = process.env.STACKS_NETWORK ?? "mainnet";
	let kind = "new_block";
	let from: number | undefined;
	let to: number | undefined;
	let out: string | undefined;
	let upload = false;
	let apply = false;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--network") network = rest[++i] ?? network;
		else if (arg === "--kind") kind = rest[++i] ?? kind;
		else if (arg === "--from") from = Number(rest[++i]);
		else if (arg === "--to") to = Number(rest[++i]);
		else if (arg === "--out") out = rest[++i];
		else if (arg === "--upload") upload = true;
		else if (arg === "--apply") apply = true;
	}
	if (kind !== "new_block" && kind !== "new_burn_block") {
		throw new Error("--kind must be new_block or new_burn_block");
	}
	if (from === undefined) throw new Error("--from is required");
	const resolvedTo = to ?? from + JOURNAL_RANGE_SIZE - 1;
	if (command === "export" && !out) throw new Error("--out is required");
	return { command, network, kind, from, to: resolvedTo, out, upload, apply };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const db = getSourceDb();
	const ranges = alignedRanges(args.from, args.to);
	let failures = 0;

	if (args.command === "export") {
		const signingPrivateKeyPem = (
			process.env.STREAMS_SIGNING_PRIVATE_KEY ?? ""
		).replace(/\\n/g, "\n");
		if (!signingPrivateKeyPem) {
			throw new Error("journal-cold: STREAMS_SIGNING_PRIVATE_KEY is required");
		}
		const hotWindowHeights = requireHotWindowHeights();
		const s3 = args.upload ? coldS3FromEnv() : undefined;
		for (const range of ranges) {
			const result = await exportJournalRange({
				db,
				network: args.network,
				kind: args.kind,
				from: range.from,
				to: range.to,
				outDir: args.out as string,
				hotWindowHeights,
				signingPrivateKeyPem,
				s3,
				apply: args.apply,
			});
			console.log(
				`${args.kind} ${range.from}-${range.to} ${result.status} rows=${result.rows} raw_bytes=${result.rawBytes} compressed_bytes=${result.compressedBytes} seconds=${result.seconds.toFixed(1)} uploaded=${result.uploaded} applied=${result.applied}`,
			);
		}
		if (!args.upload) console.log("(dry-run: nothing uploaded or recorded)");
	} else {
		const s3 = coldS3FromEnv();
		const publicKeyPem = resolvePublicKeyPem();
		const workDir = process.env.TMPDIR ?? "/tmp";
		for (const range of ranges) {
			const result = await verifyJournalRange({
				db,
				network: args.network,
				kind: args.kind,
				from: range.from,
				publicKeyPem,
				s3,
				workDir,
			});
			if (result.ok) {
				console.log(
					`${args.kind} ${range.from}-${range.to} verified rows=${result.rows}`,
				);
			} else {
				failures += 1;
				console.error(
					`${args.kind} ${range.from}-${range.to} FAILED: ${result.reason}`,
				);
			}
		}
	}

	await closeDb();
	if (failures > 0) process.exit(1);
}

if (import.meta.main) {
	main().catch(async (error) => {
		console.error(
			"journal-cold failed:",
			error instanceof Error ? error.message : error,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
}
