import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import {
	type RangeDigest,
	compareRangeDigests,
	computeRangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import { getDb, sql } from "@secondlayer/shared/db";
import type { Command } from "commander";
import {
	type ArchivePartition,
	type LoadedReference,
	checkSignature,
	fetchVerifiedPartition,
	loadReference,
	resolvePublicKey,
} from "../lib/archive-reference.ts";
import {
	dim,
	formatTable,
	note,
	output,
	printError,
	success,
	warn,
} from "../lib/output.ts";

/**
 * `secondlayer repair` — replace local chain data that diverges from a signed archive.
 *
 * This is the other half of `secondlayer verify`: verification tells an operator they
 * are broken, repair fixes it. Everything about the flow assumes the operator
 * is nervous, because they should be — this writes to a live database.
 *
 * Safety properties, in the order they matter:
 *  1. Dry-run by default. `--apply` is required to write anything.
 *  2. Nothing is written that the archive did not sign: the manifest signature
 *     is checked, then every partition's bytes are hashed against the digest
 *     that manifest declares, before a single row is read out of it.
 *  3. The plan names exact heights, not ranges. An operator should be able to
 *     read what will change without trusting a summary.
 *  4. Rows present locally but absent from the archive are REPORTED, never
 *     deleted — they are referenced by transactions and events, and silently
 *     cascading through a live database is not a repair.
 */

export const REPAIR_EXIT = {
	OK: 0,
	DIVERGENCE_REMAINS: 1,
	UNANCHORED: 2,
} as const;

type ArchiveBlock = {
	height: number;
	hash: string;
	parent_hash: string;
	burn_block_height: number;
	burn_block_hash: string | null;
	index_block_hash: string | null;
	timestamp: number;
};

type BlockFix = {
	height: number;
	kind: "replace" | "insert";
	local_hash: string | null;
	archive_hash: string;
};

function asNumber(value: unknown): number {
	return typeof value === "bigint" ? Number(value) : Number(value as number);
}

function asText(value: unknown): string {
	return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function asOptionalText(value: unknown): string | null {
	return value === null || value === undefined ? null : asText(value);
}

/** parquetjs reads from a path, so a fetched buffer is staged in a temp file. */
async function readBlocksPartition(
	bytes: Buffer,
	label: string,
): Promise<ArchiveBlock[]> {
	const path = join(tmpdir(), `sl-repair-${label}-${process.pid}.parquet`);
	await writeFile(path, bytes);
	try {
		const reader = await ParquetReader.openFile(path);
		const rows: ArchiveBlock[] = [];
		try {
			const cursor = reader.getCursor();
			for (
				let row = (await cursor.next()) as Record<string, unknown> | null;
				row;
				row = (await cursor.next()) as Record<string, unknown> | null
			) {
				rows.push({
					height: asNumber(row.height),
					hash: asText(row.hash),
					parent_hash: asText(row.parent_hash),
					burn_block_height: asNumber(row.burn_block_height),
					burn_block_hash: asOptionalText(row.burn_block_hash),
					index_block_hash: asOptionalText(row.index_block_hash),
					timestamp: asNumber(row.timestamp),
				});
			}
		} finally {
			await reader.close();
		}
		return rows;
	} finally {
		await unlink(path).catch(() => {});
	}
}

function parseHeight(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer, got "${value}"`);
	}
	return parsed;
}

async function planRange(
	db: ReturnType<typeof getDb>,
	reference: LoadedReference,
	partition: ArchivePartition,
): Promise<{ fixes: BlockFix[]; extraHeights: number[] }> {
	const bytes = await fetchVerifiedPartition(reference, partition);
	const archiveBlocks = await readBlocksPartition(
		bytes,
		`${partition.from_block}-${partition.to_block}`,
	);

	const localRows = await db
		.selectFrom("blocks")
		.select(["height", "hash"])
		.where("canonical", "=", true)
		.where("height", ">=", partition.from_block)
		.where("height", "<=", partition.to_block)
		.execute();
	const localByHeight = new Map(
		localRows.map((r) => [Number(r.height), r.hash] as const),
	);

	const fixes: BlockFix[] = [];
	for (const block of archiveBlocks) {
		const localHash = localByHeight.get(block.height);
		if (localHash === undefined) {
			fixes.push({
				height: block.height,
				kind: "insert",
				local_hash: null,
				archive_hash: block.hash,
			});
		} else if (localHash !== block.hash) {
			fixes.push({
				height: block.height,
				kind: "replace",
				local_hash: localHash,
				archive_hash: block.hash,
			});
		}
		localByHeight.delete(block.height);
	}
	// Whatever remains is canonical locally but absent from the archive.
	const extraHeights = [...localByHeight.keys()].sort((a, b) => a - b);

	return { fixes, extraHeights };
}

async function applyFixes(
	db: ReturnType<typeof getDb>,
	reference: LoadedReference,
	partition: ArchivePartition,
	fixes: readonly BlockFix[],
): Promise<number> {
	if (fixes.length === 0) return 0;
	const bytes = await fetchVerifiedPartition(reference, partition);
	const archiveBlocks = await readBlocksPartition(
		bytes,
		`apply-${partition.from_block}`,
	);
	const byHeight = new Map(archiveBlocks.map((b) => [b.height, b] as const));
	const targets = fixes
		.map((fix) => byHeight.get(fix.height))
		.filter((b): b is ArchiveBlock => b !== undefined);

	// One transaction per partition: a partition either lands whole or not at
	// all, so an interrupted repair never leaves a half-corrected range.
	await db.transaction().execute(async (tx) => {
		for (const block of targets) {
			await sql`
				INSERT INTO blocks (
					height, hash, parent_hash, burn_block_height,
					burn_block_hash, index_block_hash, timestamp, canonical
				) VALUES (
					${block.height}, ${block.hash}, ${block.parent_hash},
					${block.burn_block_height}, ${block.burn_block_hash},
					${block.index_block_hash}, ${block.timestamp}, true
				)
				ON CONFLICT (height) DO UPDATE SET
					hash = EXCLUDED.hash,
					parent_hash = EXCLUDED.parent_hash,
					burn_block_height = EXCLUDED.burn_block_height,
					burn_block_hash = EXCLUDED.burn_block_hash,
					index_block_hash = EXCLUDED.index_block_hash,
					timestamp = EXCLUDED.timestamp,
					canonical = true
			`.execute(tx);
		}
	});
	return targets.length;
}

export function registerRepairCommand(program: Command): void {
	program
		.command("repair")
		.description(
			"Replace local chain data that diverges from a signed archive (dry-run by default)",
		)
		.requiredOption(
			"--against <manifest>",
			"archive manifest: an https URL or a local file path",
		)
		.option("--from-block <n>", "first height to consider")
		.option("--to-block <n>", "last height to consider")
		.option("--apply", "write the repair (default is a dry-run plan)")
		.option("--public-key <pem>", "pin the signing key instead of fetching it")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer repair --against ./snapshot.json                      # plan only
  $ secondlayer repair --against ./snapshot.json --apply              # write the fix
  $ secondlayer repair --against ./snapshot.json --from-block 8500000 --to-block 8549999

Exit codes:
  0  nothing to repair, or the repair completed and re-verified clean
  1  divergence remains (dry-run, or repair did not fully resolve it)
  2  unanchored — reference unavailable or unverifiable`,
		)
		.action(async (opts) => {
			try {
				const fromBlock =
					opts.fromBlock === undefined
						? undefined
						: parseHeight(opts.fromBlock, "--from-block");
				const toBlock =
					opts.toBlock === undefined
						? undefined
						: parseHeight(opts.toBlock, "--to-block");

				const reference = await loadReference(opts.against);
				const publicKey = await resolvePublicKey(
					opts.publicKey,
					process.env.SL_API_URL ?? "https://api.secondlayer.tools",
				);
				const signature = checkSignature(reference.manifest, publicKey, false);
				// Repair writes to a live database. Unlike verify, there is no
				// --insecure escape hatch: unverified data must never be written.
				if (!signature.verified) {
					printError(
						`Refusing to repair from an untrusted reference: ${signature.reason}.`,
						{
							hint: "Pass --public-key <pem> to pin the archive's signing key.",
						},
					);
					process.exit(REPAIR_EXIT.UNANCHORED);
				}

				const db = getDb();
				const inRange = (from: number, to: number) =>
					!(
						(fromBlock !== undefined && to < fromBlock) ||
						(toBlock !== undefined && from > toBlock)
					);

				// Find divergent ranges the cheap way first, so repair only reads
				// the partitions it actually needs.
				const referenceDigests = (
					reference.manifest.range_digests ?? []
				).filter(
					(d) => d.dataset === "blocks" && inRange(d.from_block, d.to_block),
				);
				if (referenceDigests.length === 0) {
					printError(
						"The reference publishes no block digests for that range.",
						{
							hint: "Check --from-block/--to-block against the manifest's coverage.",
						},
					);
					process.exit(REPAIR_EXIT.UNANCHORED);
				}

				const local: RangeDigest[] = [];
				for (const range of referenceDigests) {
					local.push(
						await computeRangeDigest(
							db,
							"blocks",
							range.from_block,
							range.to_block,
						),
					);
				}
				const divergent = compareRangeDigests(local, referenceDigests).filter(
					(c) => c.status !== "match",
				);

				if (divergent.length === 0) {
					success("Nothing to repair — local blocks match the archive.");
					output({
						json: opts.json,
						data: { status: "clean", fixes: [] },
						human: () => {},
					});
					process.exit(REPAIR_EXIT.OK);
				}

				const partitions = (reference.manifest.partitions ?? []).filter(
					(p) =>
						p.dataset === "blocks" &&
						divergent.some(
							(d) => d.from_block === p.from_block && d.to_block === p.to_block,
						),
				);

				const allFixes: BlockFix[] = [];
				const allExtra: number[] = [];
				const planned: Array<{
					partition: ArchivePartition;
					fixes: BlockFix[];
				}> = [];
				for (const partition of partitions) {
					note(
						`  reading ${partition.dataset} ${partition.from_block}-${partition.to_block}`,
					);
					const { fixes, extraHeights } = await planRange(
						db,
						reference,
						partition,
					);
					planned.push({ partition, fixes });
					allFixes.push(...fixes);
					allExtra.push(...extraHeights);
				}

				let applied = 0;
				if (opts.apply) {
					for (const { partition, fixes } of planned) {
						applied += await applyFixes(db, reference, partition, fixes);
					}
				}

				// Re-verify after writing: a repair that does not end in a clean
				// verification is not a repair, it is a hope.
				let remaining = divergent.length;
				if (opts.apply) {
					const after: RangeDigest[] = [];
					for (const range of referenceDigests) {
						after.push(
							await computeRangeDigest(
								db,
								"blocks",
								range.from_block,
								range.to_block,
							),
						);
					}
					remaining = compareRangeDigests(after, referenceDigests).filter(
						(c) => c.status !== "match",
					).length;
				}

				const report = {
					status: opts.apply
						? remaining === 0
							? "repaired"
							: "incomplete"
						: "plan",
					reference: reference.origin,
					divergent_ranges: divergent.length,
					blocks_to_replace: allFixes.filter((f) => f.kind === "replace")
						.length,
					blocks_to_insert: allFixes.filter((f) => f.kind === "insert").length,
					local_only_heights: allExtra,
					applied,
					fixes: allFixes,
				};

				output({
					json: opts.json,
					data: report,
					human: () => {
						const replace = report.blocks_to_replace;
						const insert = report.blocks_to_insert;
						if (opts.apply) {
							if (remaining === 0) {
								success(
									`Repaired ${applied} blocks across ${divergent.length} ranges; re-verified clean.`,
								);
							} else {
								warn(
									`Applied ${applied} blocks but ${remaining} ranges still diverge.`,
								);
							}
						} else {
							warn(
								`${divergent.length} ranges diverge — ${replace} blocks to replace, ${insert} to insert.`,
							);
						}
						if (allFixes.length > 0) {
							console.error("");
							console.error(
								formatTable(
									["HEIGHT", "ACTION", "LOCAL", "ARCHIVE"],
									allFixes
										.slice(0, 20)
										.map((f) => [
											String(f.height),
											f.kind,
											(f.local_hash ?? "—").slice(0, 18),
											f.archive_hash.slice(0, 18),
										]),
								),
							);
							if (allFixes.length > 20) {
								console.error(dim(`  … and ${allFixes.length - 20} more`));
							}
						}
						if (allExtra.length > 0) {
							console.error("");
							warn(
								`${allExtra.length} local heights are absent from the archive (e.g. ${allExtra.slice(0, 5).join(", ")}).`,
							);
							console.error(
								dim(
									"  These are NOT removed — transactions and events reference them.",
								),
							);
						}
						if (!opts.apply) {
							console.error("");
							console.error(
								dim("(dry-run — pass --apply to write the repair)"),
							);
						} else {
							console.error("");
							console.error(
								dim(
									"Decoded rows for repaired heights are not rebuilt here — re-run your decoders for these ranges.",
								),
							);
						}
					},
				});

				process.exit(
					opts.apply && remaining === 0
						? REPAIR_EXIT.OK
						: REPAIR_EXIT.DIVERGENCE_REMAINS,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				// The hint has to match the failure or it sends people the wrong way:
				// a digest mismatch is a corrupt/tampered archive, not a misconfigured
				// connection string.
				const hint = /failed verification/.test(message)
					? "The archive object does not match its signed digest — re-download it, and report this if it persists."
					: /could not fetch/.test(message)
						? "Check the archive URL and your network connection."
						: "Set DATABASE_URL to the instance you want to repair.";
				printError(message, { hint });
				process.exit(REPAIR_EXIT.UNANCHORED);
			}
		});
}
