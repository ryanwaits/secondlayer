import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import {
	type ArchiveDataset,
	copyStatement,
	writeRowsToCopyStream,
} from "@secondlayer/shared/archive/copy-loader";
import {
	type RangeDigest,
	type RangeDigestDataset,
	compareRangeDigests,
	computeRangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import { getDb, getRawClient } from "@secondlayer/shared/db";
import type { Command } from "commander";
import {
	ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE,
	type ArchiveGate,
	confirmationRequiredPayload,
	createGatedFetcher,
	formatInsufficientMessage,
	formatQuoteValue,
	isOfficialArchive,
	quoteArchiveFetch,
	shouldPromptForGatedFetch,
} from "../lib/archive-gate.ts";
import {
	ArchiveFetchError,
	type ArchivePartition,
	type LoadedReference,
	checkSignature,
	fetchVerifiedPartition,
	loadReference,
	resolveArchivePublicKey,
} from "../lib/archive-reference.ts";
import {
	confirmDestructive,
	dim,
	formatTable,
	note,
	output,
	printError,
	success,
	warn,
	writeData,
} from "../lib/output.ts";
import { readPartitionRows } from "../lib/parquet-rows.ts";
import { isOssMode } from "../lib/resolve-auth.ts";

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
 *  5. A fixed block takes its transactions and events with it. A block row
 *     rewritten to the archive's hash while the old fork's transactions still
 *     hang off that height is not repaired, it is inconsistent in a new way.
 *     When the reference carries no child partition for a height, the block
 *     is rewritten alone and the run says so and exits incomplete.
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
	gate: ArchiveGate | undefined,
): Promise<{ fixes: BlockFix[]; extraHeights: number[] }> {
	const bytes = await fetchVerifiedPartition(reference, partition, gate);
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

type ChildDataset = "transactions" | "events";
const CHILD_DATASETS: readonly ChildDataset[] = ["transactions", "events"];
const REPAIR_DATASETS: readonly RangeDigestDataset[] = [
	"blocks",
	"transactions",
	"events",
];

/**
 * The child partition covering one height. The publisher partitions every
 * dataset on the same boundaries, so a lookup by containment is exact, and a
 * miss means the reference genuinely lacks that dataset for the height.
 */
export function childPartitionFor(
	partitions: readonly ArchivePartition[],
	dataset: ChildDataset,
	height: number,
): ArchivePartition | undefined {
	return partitions.find(
		(p) =>
			p.dataset === dataset && p.from_block <= height && p.to_block >= height,
	);
}

export type ChildRewritePlan = {
	/** Partition path to the heights it must supply, per child dataset. */
	byPartition: Map<string, { partition: ArchivePartition; heights: number[] }>;
	/** Heights the reference cannot rewrite for that dataset. */
	missing: Record<ChildDataset, number[]>;
	/** Heights both child datasets can be rewritten for. A height with only
	 *  one child partition is left alone underneath: events reference
	 *  transactions, so rewriting one without the other cannot land. */
	rewritable: number[];
};

/** Which child partitions a set of fixed heights needs, and which heights
 *  the reference cannot serve. Pure so the incomplete path is testable. */
export function planChildRewrite(
	partitions: readonly ArchivePartition[],
	heights: readonly number[],
): ChildRewritePlan {
	const missing: Record<ChildDataset, number[]> = {
		transactions: [],
		events: [],
	};
	const found = new Map<
		number,
		Partial<Record<ChildDataset, ArchivePartition>>
	>();
	for (const dataset of CHILD_DATASETS) {
		for (const height of heights) {
			const partition = childPartitionFor(partitions, dataset, height);
			if (!partition) {
				missing[dataset].push(height);
				continue;
			}
			found.set(height, { ...found.get(height), [dataset]: partition });
		}
	}
	const rewritable = heights.filter((h) => {
		const entry = found.get(h);
		return !!entry?.transactions && !!entry?.events;
	});
	const byPartition = new Map<
		string,
		{ partition: ArchivePartition; heights: number[] }
	>();
	for (const height of rewritable) {
		for (const dataset of CHILD_DATASETS) {
			const partition = found.get(height)?.[dataset];
			if (!partition) continue;
			const entry = byPartition.get(partition.path) ?? {
				partition,
				heights: [],
			};
			entry.heights.push(height);
			byPartition.set(partition.path, entry);
		}
	}
	return { byPartition, missing, rewritable };
}

async function* onlyHeights(
	rows: AsyncIterable<Record<string, unknown>>,
	heights: ReadonlySet<number>,
): AsyncGenerator<Record<string, unknown>> {
	for await (const row of rows) {
		if (heights.has(asNumber(row.block_height))) yield row;
	}
}

type AppliedFixes = {
	blocks: number;
	transactions: number;
	events: number;
	missing: Record<ChildDataset, number[]>;
	/** Heights whose transactions and events were actually rewritten. */
	rewritten: number[];
};

/**
 * Write one partition's fixes in a single transaction: the block rows land,
 * the old transactions and events at every fixed height are deleted, and the
 * archive's rows for those heights are COPYed back in. A partition either
 * lands whole or not at all, so an interrupted repair never leaves a
 * half-corrected range, and no child row ever outlives its block's identity.
 */
async function applyFixes(
	rawClient: ReturnType<typeof getRawClient>,
	reference: LoadedReference,
	partition: ArchivePartition,
	fixes: readonly BlockFix[],
	gate: ArchiveGate | undefined,
): Promise<AppliedFixes> {
	const applied: AppliedFixes = {
		blocks: 0,
		transactions: 0,
		events: 0,
		missing: { transactions: [], events: [] },
		rewritten: [],
	};
	if (fixes.length === 0) return applied;
	const bytes = await fetchVerifiedPartition(reference, partition, gate);
	const archiveBlocks = await readBlocksPartition(
		bytes,
		`apply-${partition.from_block}`,
	);
	const byHeight = new Map(archiveBlocks.map((b) => [b.height, b] as const));
	const targets = fixes
		.map((fix) => byHeight.get(fix.height))
		.filter((b): b is ArchiveBlock => b !== undefined);
	const heights = targets.map((b) => b.height);

	const children = planChildRewrite(
		reference.manifest.partitions ?? [],
		heights,
	);
	applied.missing = children.missing;
	applied.rewritten = children.rewritable;
	const rewritable = new Set(children.rewritable);
	// Every child partition is fetched and digest-checked before the
	// transaction opens, so a bad download never holds a write lock.
	const childBytes = new Map<string, Buffer>();
	for (const [path, { partition: child }] of children.byPartition) {
		childBytes.set(path, await fetchVerifiedPartition(reference, child, gate));
	}

	await rawClient.begin(async (tx) => {
		// Only heights the archive can refill lose their children: a stale
		// fork transaction that stays put is named in the report, while a
		// deleted one would be a hole nothing names.
		for (const height of rewritable) {
			await tx.unsafe("DELETE FROM events WHERE block_height = $1", [height]);
			await tx.unsafe("DELETE FROM transactions WHERE block_height = $1", [
				height,
			]);
		}
		for (const block of targets) {
			await tx.unsafe(
				`INSERT INTO blocks (
					height, hash, parent_hash, burn_block_height,
					burn_block_hash, index_block_hash, timestamp, canonical
				) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
				ON CONFLICT (height) DO UPDATE SET
					hash = EXCLUDED.hash,
					parent_hash = EXCLUDED.parent_hash,
					burn_block_height = EXCLUDED.burn_block_height,
					burn_block_hash = EXCLUDED.burn_block_hash,
					index_block_hash = EXCLUDED.index_block_hash,
					timestamp = EXCLUDED.timestamp,
					canonical = true`,
				[
					block.height,
					block.hash,
					block.parent_hash,
					block.burn_block_height,
					block.burn_block_hash,
					block.index_block_hash,
					block.timestamp,
				],
			);
		}
		applied.blocks = targets.length;
		// FK order: transactions before events.
		for (const dataset of CHILD_DATASETS) {
			for (const [path, { partition: child }] of children.byPartition) {
				if (child.dataset !== dataset) continue;
				const bytes = childBytes.get(path);
				if (!bytes) continue;
				const writable = await tx
					.unsafe(copyStatement(dataset as ArchiveDataset))
					.writable();
				applied[dataset] += await writeRowsToCopyStream({
					writable,
					dataset,
					rows: onlyHeights(
						readPartitionRows(bytes, `repair-${dataset}-${child.from_block}`),
						rewritable,
					),
				});
			}
		}
	});
	return applied;
}

/** Re-verify every dataset the reference publishes digests for over the
 *  repaired ranges. A repair that does not end in a clean verification is
 *  not a repair, it is a hope; a repair verified on blocks alone is a
 *  narrower hope. */
async function reverify(
	db: ReturnType<typeof getDb>,
	reference: LoadedReference,
	ranges: readonly { from_block: number; to_block: number }[],
): Promise<Record<RangeDigestDataset, number>> {
	const remaining: Record<RangeDigestDataset, number> = {
		blocks: 0,
		transactions: 0,
		events: 0,
	};
	const published = reference.manifest.range_digests ?? [];
	for (const dataset of REPAIR_DATASETS) {
		const expected = published.filter(
			(d) =>
				d.dataset === dataset &&
				ranges.some(
					(r) => r.from_block === d.from_block && r.to_block === d.to_block,
				),
		);
		const actual: RangeDigest[] = [];
		for (const range of expected) {
			actual.push(
				await computeRangeDigest(db, dataset, range.from_block, range.to_block),
			);
		}
		remaining[dataset] = compareRangeDigests(actual, expected).filter(
			(c) => c.status !== "match",
		).length;
	}
	return remaining;
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
		.option(
			"--public-key <pem>",
			"pin a signing key; default is the archive key built into this release",
		)
		.option("-y, --yes", "skip the confirmation prompt for a metered fetch")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer repair --against ./snapshot.json                      # plan only
  $ secondlayer repair --against ./snapshot.json --apply              # write the fix
  $ secondlayer repair --against ./snapshot.json --from-block 8500000 --to-block 8549999

A fixed block is rewritten together with its transactions and events from the
archive's partitions for that height. When the reference carries no
transactions or events partition for a height, the block is rewritten alone,
the run names the height, and it exits 1.

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

				const publicKey = await resolveArchivePublicKey({
					explicitPem: opts.publicKey,
					envPem:
						process.env.ARCHIVE_SIGNING_PUBLIC_KEY ??
						process.env.STREAMS_SIGNING_PUBLIC_KEY,
					allowHostedApi: !isOssMode(),
				});
				const reference = await loadReference(opts.against, {
					publicKeyPem: publicKey,
				});
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
				// `--apply` also rewrites the transactions and events at every
				// fixed height, so the quote covers the child partitions that
				// overlap the divergent ranges. A dry-run reads blocks only.
				const childPartitions = opts.apply
					? (reference.manifest.partitions ?? []).filter(
							(p) =>
								(p.dataset === "transactions" || p.dataset === "events") &&
								divergent.some(
									(d) =>
										p.from_block <= d.to_block && p.to_block >= d.from_block,
								),
						)
					: [];
				const fetchPaths = [...partitions, ...childPartitions].map(
					(p) => p.path,
				);

				// Metered fetches apply ONLY against the official hosted archive. A
				// mirror, a teammate's box, or a local directory never reaches this
				// module's HTTP seam — self-hosting is the product working as
				// designed, not a billing leak. Repair reads partition bytes to
				// build the plan even in dry-run, so the gate engages here, before
				// any partition is read — not only when `--apply` writes.
				let gate: ArchiveGate | undefined;
				let quoteLine: string | undefined;
				if (isOfficialArchive(reference)) {
					const paths = fetchPaths;
					const result = await quoteArchiveFetch(paths, "repair");
					if (!result.ok) {
						printError(
							result.kind === "not_configured"
								? ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE
								: result.message,
						);
						process.exit(REPAIR_EXIT.UNANCHORED);
					}
					if (!result.quote.sufficient) {
						printError(formatInsufficientMessage(result.quote));
						process.exit(REPAIR_EXIT.UNANCHORED);
					}
					quoteLine = formatQuoteValue(result.quote, "repair");
					note(`  metered: ${quoteLine}`);
					if (shouldPromptForGatedFetch(opts)) {
						if (opts.json) {
							// `--json` shapes the output; it never stands in for `-y`.
							writeData(
								JSON.stringify(confirmationRequiredPayload(result.quote)),
							);
							process.exit(REPAIR_EXIT.UNANCHORED);
						}
						const proceed = await confirmDestructive({
							message: `Fetch ${fetchPaths.length} partition(s) from the archive?`,
							yes: opts.yes,
						});
						if (!proceed) {
							note("Nothing was fetched.");
							process.exit(REPAIR_EXIT.UNANCHORED);
						}
					}
					gate = createGatedFetcher(paths, "repair");
				}

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
						gate,
					);
					planned.push({ partition, fixes });
					allFixes.push(...fixes);
					allExtra.push(...extraHeights);
				}

				const applied = { blocks: 0, transactions: 0, events: 0 };
				const missingChild: Record<ChildDataset, number[]> = {
					transactions: [],
					events: [],
				};
				let childrenRewritten = 0;
				if (opts.apply) {
					const rawClient = getRawClient("source");
					for (const { partition, fixes } of planned) {
						const result = await applyFixes(
							rawClient,
							reference,
							partition,
							fixes,
							gate,
						);
						applied.blocks += result.blocks;
						applied.transactions += result.transactions;
						applied.events += result.events;
						missingChild.transactions.push(...result.missing.transactions);
						missingChild.events.push(...result.missing.events);
						childrenRewritten += result.rewritten.length;
					}
				}
				const missingHeights = [
					...new Set([...missingChild.transactions, ...missingChild.events]),
				].sort((a, b) => a - b);
				// What was actually written, not what the reference could serve:
				// a height with a transactions partition but no events partition
				// is left alone underneath, so neither child counts as rewritten.
				const rewritten: RangeDigestDataset[] = opts.apply
					? REPAIR_DATASETS.filter(
							(d) => d === "blocks" || childrenRewritten > 0,
						)
					: [];

				// Re-verify after writing, on every dataset the reference publishes
				// digests for. Blocks alone would call a stale transactions table
				// clean.
				let remainingByDataset: Record<RangeDigestDataset, number> = {
					blocks: divergent.length,
					transactions: 0,
					events: 0,
				};
				if (opts.apply) {
					remainingByDataset = await reverify(db, reference, referenceDigests);
				}
				const remaining =
					remainingByDataset.blocks +
					remainingByDataset.transactions +
					remainingByDataset.events;
				const complete =
					!!opts.apply && remaining === 0 && missingHeights.length === 0;

				const report = {
					status: opts.apply ? (complete ? "repaired" : "incomplete") : "plan",
					reference: reference.origin,
					divergent_ranges: divergent.length,
					blocks_to_replace: allFixes.filter((f) => f.kind === "replace")
						.length,
					blocks_to_insert: allFixes.filter((f) => f.kind === "insert").length,
					local_only_heights: allExtra,
					applied: applied.blocks,
					rows_written: applied,
					datasets_rewritten: rewritten,
					heights_missing_child_partitions: missingHeights,
					remaining_by_dataset: remainingByDataset,
					fixes: allFixes,
					metered: quoteLine ?? null,
				};

				// The remedy prints on stderr in every output mode: a script reading
				// the JSON report gets the heights in
				// `heights_missing_child_partitions`, and the operator watching the
				// run sees the exact command either way.
				if (missingHeights.length > 0) {
					// Name the exact remedy: these heights are consistent on
					// blocks and stale underneath, and nothing else says so.
					for (const dataset of CHILD_DATASETS) {
						const heights = missingChild[dataset];
						if (heights.length === 0) continue;
						warn(
							`  the reference has no ${dataset} partition for ${heights.length} height(s): ${heights.slice(0, 5).join(", ")}${heights.length > 5 ? ", …" : ""}`,
						);
					}
					for (const height of missingHeights.slice(0, 5)) {
						console.error(
							dim(
								`  transactions/events at ${height}: run \`secondlayer bootstrap --from-block ${height} --to-block ${height}\``,
							),
						);
					}
				}

				output({
					json: opts.json,
					data: report,
					human: () => {
						const replace = report.blocks_to_replace;
						const insert = report.blocks_to_insert;
						if (opts.apply) {
							const written = `${applied.blocks} blocks, ${applied.transactions} transactions, ${applied.events} events`;
							if (complete) {
								success(
									`Repaired ${applied.blocks} heights across ${divergent.length} ranges (rewrote ${written}); re-verified clean on ${rewritten.join(", ")}.`,
								);
							} else if (remaining > 0) {
								const byDataset = REPAIR_DATASETS.map(
									(d) => `${remainingByDataset[d]} ${d}`,
								).join(", ");
								warn(
									`Rewrote ${written} but ${remaining} ranges still diverge (${byDataset}).`,
								);
							} else {
								warn(
									`Rewrote ${written}; blocks re-verified clean, but transactions and events at ${missingHeights.length} height(s) were not rewritten.`,
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
					complete ? REPAIR_EXIT.OK : REPAIR_EXIT.DIVERGENCE_REMAINS,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (err instanceof ArchiveFetchError && err.transient) {
					// The network gave out, not the archive. Heights already
					// repaired are committed, so the remedy is a re-run, and the
					// exit code says "unfinished", not "refused".
					printError(message, {
						hint: "The archive could not be reached. Re-run the same command to resume; heights already repaired are kept.",
					});
					process.exit(REPAIR_EXIT.DIVERGENCE_REMAINS);
				}
				// The hint has to match the failure or it sends people the wrong way:
				// a digest mismatch is a corrupt/tampered archive, not a misconfigured
				// connection string.
				const hint = /pointer|leave the archive root/.test(message)
					? "The archive pointer failed its integrity check. Pass --against the snapshot URL directly, and report this if the pointer is the official latest.json."
					: /failed verification/.test(message)
						? "The archive object does not match its signed digest. Re-download it, and report this if it persists."
						: /could not fetch/.test(message)
							? "Check the archive URL and your network connection."
							: "Set DATABASE_URL to the instance you want to repair.";
				printError(message, { hint });
				process.exit(REPAIR_EXIT.UNANCHORED);
			}
		});
}
