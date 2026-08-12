import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParquetReader } from "@dsnp/parquetjs";
import { confirm } from "@inquirer/prompts";
import {
	type ArchiveDataset,
	type ArchiveRow,
	copyStatement,
	writeRowsToCopyStream,
} from "@secondlayer/shared/archive/copy-loader";
import { computeRangeDigest } from "@secondlayer/shared/archive/range-digest";
import { getDb, getRawClient } from "@secondlayer/shared/db";
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
	bold,
	dim,
	formatKeyValue,
	note,
	output,
	printError,
	success,
	warn,
} from "../lib/output.ts";

/**
 * `sl bootstrap` — stand up a Secondlayer instance from a verified archive
 * instead of replaying the chain from genesis.
 *
 * This exists because the honest alternative is measured in days. Replaying
 * ~8.7M blocks through a node takes on the order of a week and a half; the same
 * history restores from signed Parquet in about two hours. That difference is
 * the entire value, so the command leads with it: it shows both numbers and
 * lets the operator choose, rather than assuming.
 *
 * It refuses to touch a non-empty database. Bootstrapping is a first-run
 * operation, and merging archive history into an instance that already holds
 * data is how you get a chain that looks complete and isn't — exactly the
 * failure `sl verify` exists to catch. An operator repairing an existing
 * instance wants `sl repair`, which is targeted and reversible in a way this
 * is not.
 */

export const BOOTSTRAP_EXIT = {
	OK: 0,
	INCOMPLETE: 1,
	REFUSED: 2,
} as const;

/** Nakamoto produces roughly this many Stacks blocks per day. Used only to
 *  express the from-genesis alternative in days; it is a scale estimate, not a
 *  promise, and is labelled as such in the output. */
const BLOCKS_PER_DAY_ESTIMATE = 5_400;
/** Conservative COPY throughput floor, measured at ~64k rows/s on commodity
 *  hardware; halved here so the ETA reads pessimistic rather than optimistic. */
const RESTORE_ROWS_PER_SECOND = 30_000;

function formatDuration(seconds: number): string {
	if (seconds < 90) return `${Math.round(seconds)}s`;
	if (seconds < 5_400) return `${Math.round(seconds / 60)} min`;
	if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)} hours`;
	return `${(seconds / 86_400).toFixed(1)} days`;
}

async function* readPartitionRows(
	bytes: Buffer,
	label: string,
): AsyncGenerator<ArchiveRow> {
	const path = join(tmpdir(), `sl-bootstrap-${label}-${process.pid}.parquet`);
	await writeFile(path, bytes);
	try {
		const reader = await ParquetReader.openFile(path);
		try {
			const cursor = reader.getCursor();
			for (
				let row = (await cursor.next()) as ArchiveRow | null;
				row;
				row = (await cursor.next()) as ArchiveRow | null
			) {
				yield row;
			}
		} finally {
			await reader.close();
		}
	} finally {
		await unlink(path).catch(() => {});
	}
}

async function loadPartition(
	reference: LoadedReference,
	partition: ArchivePartition,
	rawClient: ReturnType<typeof getRawClient>,
): Promise<number> {
	const bytes = await fetchVerifiedPartition(reference, partition);
	const writable = await rawClient
		.unsafe(copyStatement(partition.dataset as ArchiveDataset))
		.writable();
	const written = await writeRowsToCopyStream({
		writable,
		dataset: partition.dataset as ArchiveDataset,
		rows: readPartitionRows(
			bytes,
			`${partition.dataset}-${partition.from_block}`,
		),
	});
	if (written !== partition.row_count) {
		throw new Error(
			`${partition.path}: loaded ${written} rows, manifest declares ${partition.row_count}`,
		);
	}
	return written;
}

export function registerBootstrapCommand(program: Command): void {
	program
		.command("bootstrap")
		.description(
			"Restore chain history from a verified archive instead of syncing from genesis",
		)
		.requiredOption(
			"--against <manifest>",
			"archive manifest: an https URL or a local file path",
		)
		.option("--to-block <n>", "stop at this height instead of the archive tip")
		.option("--public-key <pem>", "pin the signing key instead of fetching it")
		.option("-y, --yes", "skip the confirmation prompt")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ sl bootstrap --against https://archive.secondlayer.tools/.../snapshots/<digest>.json
  $ sl bootstrap --against ./snapshot.json --to-block 4000000 --yes

Exit codes:
  0  restored and verified
  1  restore completed but verification found divergence
  2  refused (non-empty target, or an untrusted reference)`,
		)
		.action(async (opts) => {
			try {
				const reference = await loadReference(opts.against);
				const publicKey = await resolvePublicKey(
					opts.publicKey,
					process.env.SL_API_URL ?? "https://api.secondlayer.tools",
				);
				const signature = checkSignature(reference.manifest, publicKey, false);
				// No --insecure here. Bootstrap writes an entire chain history into a
				// database; doing that from an unverified source would poison the
				// instance at its foundation.
				if (!signature.verified) {
					printError(
						`Refusing to bootstrap from an untrusted archive: ${signature.reason}.`,
						{
							hint: "Pass --public-key <pem> to pin the archive's signing key.",
						},
					);
					process.exit(BOOTSTRAP_EXIT.REFUSED);
				}

				const db = getDb();
				const existing = await db
					.selectFrom("blocks")
					.select(({ fn }) => fn.countAll<string>().as("count"))
					.executeTakeFirst();
				if (Number(existing?.count ?? 0) > 0) {
					printError("This database already holds blocks.", {
						hint: "Bootstrap is for a fresh instance. To fix an existing one, use `sl repair`.",
					});
					process.exit(BOOTSTRAP_EXIT.REFUSED);
				}

				const toBlock =
					opts.toBlock === undefined ? undefined : Number(opts.toBlock);
				const partitions = (reference.manifest.partitions ?? []).filter(
					(p) => toBlock === undefined || p.to_block <= toBlock,
				);
				if (partitions.length === 0) {
					printError("The archive has no partitions for that range.", {
						hint: "Check --to-block against the manifest's coverage.",
					});
					process.exit(BOOTSTRAP_EXIT.REFUSED);
				}

				const totalRows = partitions.reduce((sum, p) => sum + p.row_count, 0);
				const totalBytes = partitions.reduce((sum, p) => sum + p.byte_size, 0);
				const tipHeight = Math.max(...partitions.map((p) => p.to_block));
				const restoreSeconds = totalRows / RESTORE_ROWS_PER_SECOND;
				const genesisSeconds = (tipHeight / BLOCKS_PER_DAY_ESTIMATE) * 86_400;

				// Lead with the comparison — it is the reason this command exists.
				if (!opts.json) {
					console.error("");
					console.error(
						formatKeyValue([
							["archive", reference.origin],
							["coverage", `genesis → ${tipHeight.toLocaleString()}`],
							["rows", totalRows.toLocaleString()],
							["download", `${(totalBytes / 1e9).toFixed(1)} GB`],
							["signature", "verified"],
						]),
					);
					console.error("");
					console.error(
						`  sync from genesis   ${bold(`~${formatDuration(genesisSeconds)}`)} ${dim("(estimate)")}`,
					);
					console.error(
						`  restore from archive ${bold(`~${formatDuration(restoreSeconds)}`)}`,
					);
					console.error("");
				}

				if (!opts.yes && !opts.json) {
					const proceed = await confirm({
						message: "Restore from the verified archive?",
						default: true,
					});
					if (!proceed) {
						note("Nothing was written.");
						process.exit(BOOTSTRAP_EXIT.REFUSED);
					}
				}

				// FK order is not optional: transactions reference blocks, events
				// reference transactions.
				const order: ArchiveDataset[] = ["blocks", "transactions", "events"];
				const rawClient = getRawClient("source");
				const loaded = { blocks: 0, transactions: 0, events: 0 };
				const startedAt = Date.now();

				for (const dataset of order) {
					const datasetPartitions = partitions
						.filter((p) => p.dataset === dataset)
						.sort((a, b) => a.from_block - b.from_block);
					for (const [index, partition] of datasetPartitions.entries()) {
						loaded[dataset] += await loadPartition(
							reference,
							partition,
							rawClient,
						);
						const done = index + 1;
						if (done % 10 === 0 || done === datasetPartitions.length) {
							const elapsed = (Date.now() - startedAt) / 1000;
							note(
								`  ${dataset}: ${done}/${datasetPartitions.length} partitions · ${loaded[dataset].toLocaleString()} rows · ${formatDuration(elapsed)} elapsed`,
							);
						}
					}
				}

				// A restore that is not verified is just a copy with good intentions.
				const referenceDigests = (
					reference.manifest.range_digests ?? []
				).filter((d) => d.dataset === "blocks" && d.to_block <= tipHeight);
				let divergent = 0;
				for (const range of referenceDigests) {
					const actual = await computeRangeDigest(
						db,
						"blocks",
						range.from_block,
						range.to_block,
					);
					if (
						actual.digest !== range.digest ||
						actual.row_count !== range.row_count
					) {
						divergent++;
					}
				}

				const elapsed = (Date.now() - startedAt) / 1000;
				const report = {
					status: divergent === 0 ? "restored" : "divergent",
					archive: reference.origin,
					tip_height: tipHeight,
					rows: loaded,
					ranges_verified: referenceDigests.length,
					divergent_ranges: divergent,
					elapsed_seconds: Math.round(elapsed),
				};

				output({
					json: opts.json,
					data: report,
					human: () => {
						if (divergent === 0) {
							success(
								`Restored ${loaded.blocks.toLocaleString()} blocks, ${loaded.transactions.toLocaleString()} transactions, ${loaded.events.toLocaleString()} events in ${formatDuration(elapsed)}.`,
							);
							if (referenceDigests.length > 0) {
								note(
									`  verified ${referenceDigests.length} ranges against the archive`,
								);
							} else {
								warn(
									"  archive published no block digests — restore is unverified",
								);
							}
							console.error("");
							console.error(
								dim(
									`Your instance holds history through ${tipHeight.toLocaleString()}. Start the indexer to continue from there.`,
								),
							);
						} else {
							warn(
								`Restored ${loaded.blocks.toLocaleString()} blocks but ${divergent} ranges do not match the archive.`,
							);
							console.error(
								dim("  Investigate with: sl verify --against <manifest>"),
							);
						}
					},
				});

				process.exit(
					divergent === 0 ? BOOTSTRAP_EXIT.OK : BOOTSTRAP_EXIT.INCOMPLETE,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const hint = /failed verification/.test(message)
					? "An archive object does not match its signed digest — re-download and retry."
					: /could not fetch/.test(message)
						? "Check the archive URL and your network connection."
						: "Set DATABASE_URL to the (empty) instance you want to bootstrap.";
				printError(message, { hint });
				process.exit(BOOTSTRAP_EXIT.REFUSED);
			}
		});
}
