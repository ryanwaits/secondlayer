import { createHash } from "node:crypto";
import {
	type ArchiveDataset,
	copyStatement,
	writeRowsToCopyStream,
} from "@secondlayer/shared/archive/copy-loader";
import {
	type RangeDigestDataset,
	computeRangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import { getDb, getRawClient, sql } from "@secondlayer/shared/db";
import { upsertSyncScope } from "@secondlayer/shared/db/queries/sync-scope";
import type { Command } from "commander";
import {
	ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE,
	type ArchiveGate,
	type ArchiveQuote,
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
	type ArchiveManifest,
	type ArchivePartition,
	type LoadedReference,
	checkSignature,
	fetchVerifiedPartition,
	loadReference,
	resolveArchivePublicKey,
} from "../lib/archive-reference.ts";
import {
	type DatasetHighWater,
	RESUME_DATASETS,
	partitionIsLoaded,
	planTornImport,
} from "../lib/bootstrap-resume.ts";
import {
	bold,
	confirmDestructive,
	dim,
	formatKeyValue,
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
 * `secondlayer bootstrap` — stand up a Secondlayer instance from a verified archive
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
 * failure `secondlayer verify` exists to catch. An operator repairing an existing
 * instance wants `secondlayer repair`, which is targeted and reversible in a way this
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

/**
 * Where the restored history actually begins and ends.
 *
 * The load loop only ever tracks the high-water mark, which is the wrong end
 * for a scope: the tip says how far the instance is caught up, while the LOW
 * bound is what makes everything under it deliberately absent instead of
 * missing. A `--from-block` restore has no genesis at all, so reading the
 * start off the tip would declare a scope that covers history the instance
 * never loaded.
 */
export function archiveScopeBounds(
	partitions: readonly { from_block: number; to_block: number }[],
): { start_height: number; tip_height: number } | null {
	if (partitions.length === 0) return null;
	return {
		start_height: Math.min(...partitions.map((p) => p.from_block)),
		tip_height: Math.max(...partitions.map((p) => p.to_block)),
	};
}

/**
 * The archive's identity: sha256 over the manifest minus its signature
 * envelope — the same recipe the publisher addresses snapshots with, so the
 * digest recorded in the scope is the one printed on the archive.
 */
function manifestDigest(manifest: ArchiveManifest): string {
	const { signature: _signature, key_id: _keyId, ...payload } = manifest;
	return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * The node's current Stacks tip, or null when it cannot be reached. A missing
 * node is not fatal — the restore is still valid, the operator just does not
 * learn the catch-up range — so this never throws.
 */
async function readNodeTip(): Promise<number | null> {
	const url = process.env.STACKS_NODE_RPC_URL ?? "http://localhost:20443";
	try {
		const response = await fetch(`${url.replace(/\/$/, "")}/v2/info`, {
			signal: AbortSignal.timeout(5_000),
		});
		if (!response.ok) return null;
		const info = (await response.json()) as { stacks_tip_height?: number };
		return typeof info.stacks_tip_height === "number"
			? info.stacks_tip_height
			: null;
	} catch {
		return null;
	}
}

function formatDuration(seconds: number): string {
	if (seconds < 90) return `${Math.round(seconds)}s`;
	if (seconds < 5_400) return `${Math.round(seconds / 60)} min`;
	if (seconds < 172_800) return `${(seconds / 3_600).toFixed(1)} hours`;
	return `${(seconds / 86_400).toFixed(1)} days`;
}

async function loadPartition(
	reference: LoadedReference,
	partition: ArchivePartition,
	rawClient: ReturnType<typeof getRawClient>,
	gate: ArchiveGate | undefined,
): Promise<number> {
	const bytes = await fetchVerifiedPartition(reference, partition, gate);
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

/** FK order is not optional: transactions reference blocks, events
 *  reference transactions. */
const LOAD_ORDER: readonly ArchiveDataset[] = [
	"blocks",
	"transactions",
	"events",
];

/**
 * Partitions in the exact order the load consumes them: dataset by dataset,
 * ascending height. The gate's quote and presign batches follow this order so
 * a charge lands right before its bytes are used.
 */
export function loadOrder<T extends { dataset: string; from_block: number }>(
	partitions: readonly T[],
): T[] {
	return LOAD_ORDER.flatMap((dataset) =>
		partitions
			.filter((p) => p.dataset === dataset)
			.sort((a, b) => a.from_block - b.from_block),
	);
}

/** Which datasets the post-load digest pass covers. `all` is the default:
 *  a blocks-only check cannot see a transactions partition that never
 *  landed. */
export function parseVerifyDatasets(value: unknown): RangeDigestDataset[] {
	if (value === undefined || value === "all") {
		return ["blocks", "transactions", "events"];
	}
	if (value === "blocks") return ["blocks"];
	throw new Error(`--verify must be "all" or "blocks", got "${String(value)}"`);
}

/** Per-dataset high-water marks; the resume planner needs all three because
 *  the load runs dataset by dataset and a crash lands between them. */
async function readHighWater(
	db: ReturnType<typeof getDb>,
): Promise<DatasetHighWater> {
	const asMark = (value: unknown) =>
		value === null || value === undefined ? null : Number(value);
	const blocks = await db
		.selectFrom("blocks")
		.select(({ fn }) => fn.max("height").as("max"))
		.executeTakeFirst();
	const transactions = await db
		.selectFrom("transactions")
		.select(({ fn }) => fn.max("block_height").as("max"))
		.executeTakeFirst();
	const events = await db
		.selectFrom("events")
		.select(({ fn }) => fn.max("block_height").as("max"))
		.executeTakeFirst();
	return {
		blocks: asMark(blocks?.max),
		transactions: asMark(transactions?.max),
		events: asMark(events?.max),
	};
}

async function truncateDatasetFrom(
	db: ReturnType<typeof getDb>,
	dataset: ArchiveDataset,
	from: number,
): Promise<void> {
	if (dataset === "blocks") {
		await sql`DELETE FROM blocks WHERE height >= ${from}`.execute(db);
	} else if (dataset === "transactions") {
		await sql`DELETE FROM transactions WHERE block_height >= ${from}`.execute(
			db,
		);
	} else {
		await sql`DELETE FROM events WHERE block_height >= ${from}`.execute(db);
	}
}

export function attachBootstrapCommand(cmd: Command): Command {
	return cmd
		.requiredOption(
			"--against <manifest>",
			"archive manifest: an https URL or a local file path",
		)
		.option("--to-block <n>", "stop at this height instead of the archive tip")
		.option(
			"--from-block <n>",
			"forward-only: restore from this height instead of genesis; earlier history is declared out of scope",
		)
		.option(
			"--public-key <pem>",
			"pin a signing key; default is the archive key built into this release",
		)
		.option(
			"--verify <datasets>",
			"digests checked after the load: all (blocks, transactions, events; adds minutes on a full chain) or blocks",
			"all",
		)
		.option("-y, --yes", "skip the confirmation prompt")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ secondlayer bootstrap --against https://archive.secondlayer.tools/.../snapshots/<digest>.json
  $ secondlayer bootstrap --against ./snapshot.json --to-block 4000000 --yes
  $ secondlayer bootstrap --against ./snapshot.json --from-block 8000000 --yes

Exit codes:
  0  restored and verified
  1  restore completed but verification found divergence
  2  refused (non-empty target, or an untrusted reference)`,
		)
		.action(async (opts) => {
			try {
				const verifyDatasets = parseVerifyDatasets(opts.verify);
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
				const progress = await db
					.selectFrom("index_progress")
					.select("network")
					.executeTakeFirst();
				const highWater = await readHighWater(db);

				const toBlock =
					opts.toBlock === undefined ? undefined : Number(opts.toBlock);
				// Whole partitions only: a partition straddling the requested start
				// would load blocks below the height the operator declared, and the
				// scope would then claim less history than the database holds.
				const fromBlock =
					opts.fromBlock === undefined ? undefined : Number(opts.fromBlock);
				const declared = (reference.manifest.partitions ?? []).filter(
					(p) =>
						(toBlock === undefined || p.to_block <= toBlock) &&
						(fromBlock === undefined || p.from_block >= fromBlock),
				);
				if (declared.length === 0) {
					printError("The archive has no partitions for that range.", {
						hint: "Check --from-block and --to-block against the manifest's coverage.",
					});
					process.exit(BOOTSTRAP_EXIT.REFUSED);
				}
				const resume = planTornImport({
					hasIndexProgress: !!progress,
					highWater,
					partitions: declared,
				});
				if (resume.action === "refuse") {
					printError(resume.reason, {
						hint: "Bootstrap is for a fresh instance. To fix an existing one, use `secondlayer repair`.",
					});
					process.exit(BOOTSTRAP_EXIT.REFUSED);
				}
				if (resume.action === "resume") {
					// Children first: events reference transactions, which reference
					// blocks. The planner already cascaded the heights.
					const truncated: string[] = [];
					for (const dataset of [...RESUME_DATASETS].reverse()) {
						const from = resume.truncateFrom[dataset];
						if (from === null) continue;
						await truncateDatasetFrom(db, dataset, from);
						truncated.push(`${dataset} from ${from.toLocaleString()}`);
					}
					if (truncated.length > 0) {
						note(`Resuming torn import: truncated ${truncated.join(", ")}.`);
					}
					const sealed = RESUME_DATASETS.filter(
						(d) => resume.skipThrough[d] > 0,
					).map(
						(d) => `${d} through ${resume.skipThrough[d].toLocaleString()}`,
					);
					note(
						sealed.length > 0
							? `Resuming import after sealed partitions: ${sealed.join(", ")}.`
							: "Resuming import: no partition finished, so the load starts over from the first.",
					);
				}
				const partitions = declared.filter(
					(p) =>
						resume.action === "fresh" ||
						!partitionIsLoaded(p, resume.skipThrough),
				);
				if (partitions.length === 0) {
					// Every partition landed but the run died before it wrote
					// index_progress and the scope. Refusing here would strand the
					// instance: nothing left to load means bootstrap could never
					// finish it. Verify what is there and finalize.
					note(
						"All partitions are already loaded; verifying and finalizing the import.",
					);
				}

				// Bounds come from everything the run declares, not the resume
				// remainder: a resumed import still starts where the archive starts.
				const scopeBounds = archiveScopeBounds(declared);
				const startHeight = scopeBounds?.start_height ?? 0;

				const totalRows = partitions.reduce((sum, p) => sum + p.row_count, 0);
				const totalBytes = partitions.reduce((sum, p) => sum + p.byte_size, 0);
				const tipHeight = scopeBounds?.tip_height ?? 0;
				const restoreSeconds = totalRows / RESTORE_ROWS_PER_SECOND;
				const genesisSeconds = (tipHeight / BLOCKS_PER_DAY_ESTIMATE) * 86_400;

				// Metered fetches apply ONLY against the official hosted archive. A
				// mirror, a teammate's box, or a local directory never reaches this
				// module's HTTP seam — self-hosting is the product working as
				// designed, not a billing leak.
				const gated = isOfficialArchive(reference);
				let quoteLine: string | undefined;
				let quote: ArchiveQuote | null = null;
				let gate: ArchiveGate | undefined;
				if (gated && partitions.length > 0) {
					// Paths in the order the load consumes them, so each 16-path
					// charge+presign batch is used up before the next one is issued
					// and no presigned URL for events sits expiring while blocks
					// are still being copied.
					const paths = loadOrder(partitions).map((p) => p.path);
					const result = await quoteArchiveFetch(paths, "bootstrap");
					if (!result.ok) {
						printError(
							result.kind === "not_configured"
								? ARCHIVE_GATE_NOT_CONFIGURED_MESSAGE
								: result.message,
						);
						process.exit(BOOTSTRAP_EXIT.REFUSED);
					}
					if (!result.quote.sufficient) {
						printError(formatInsufficientMessage(result.quote));
						process.exit(BOOTSTRAP_EXIT.REFUSED);
					}
					quote = result.quote;
					quoteLine = formatQuoteValue(result.quote, "bootstrap");
					gate = createGatedFetcher(paths, "bootstrap");
				}

				// Lead with the comparison — it is the reason this command exists.
				if (!opts.json) {
					console.error("");
					console.error(
						formatKeyValue([
							["archive", reference.origin],
							[
								"coverage",
								`${startHeight === 0 ? "genesis" : startHeight.toLocaleString()} → ${tipHeight.toLocaleString()}`,
							],
							["rows", totalRows.toLocaleString()],
							["download", `${(totalBytes / 1e9).toFixed(1)} GB`],
							["signature", "verified"],
							...(quoteLine
								? ([["metered", quoteLine]] as [string, string][])
								: []),
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

				// Nothing left to fetch or write means nothing to consent to: the
				// confirm guards the restore, and a zero-row restore is not one.
				if (partitions.length > 0 && shouldPromptForGatedFetch(opts)) {
					if (opts.json) {
						// `--json` shapes the output; it never stands in for `-y`. The
						// quote goes to stderr as chrome and to stdout as data, so a
						// script sees the price before anything is charged or written.
						if (quoteLine) note(`  metered: ${quoteLine}`);
						writeData(JSON.stringify(confirmationRequiredPayload(quote)));
						process.exit(BOOTSTRAP_EXIT.REFUSED);
					}
					const proceed = await confirmDestructive({
						message: "Restore from the verified archive?",
						yes: opts.yes,
					});
					if (!proceed) {
						note("Nothing was written.");
						process.exit(BOOTSTRAP_EXIT.REFUSED);
					}
				}

				// Read the node's tip BEFORE loading. The chain keeps producing for
				// the whole restore, so the catch-up range is measured from where
				// the chain was when we started, not where it ends up.
				const nodeTipAtStart = await readNodeTip();

				const rawClient = getRawClient("source");
				const loaded = { blocks: 0, transactions: 0, events: 0 };
				const startedAt = Date.now();

				for (const dataset of LOAD_ORDER) {
					const datasetPartitions = loadOrder(partitions).filter(
						(p) => p.dataset === dataset,
					);
					for (const [index, partition] of datasetPartitions.entries()) {
						loaded[dataset] += await loadPartition(
							reference,
							partition,
							rawClient,
							gate,
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
				// Only ranges inside what this run declared count: a forward-only
				// restore never loaded anything below --from-block, and a digest
				// over those empty rows would read as divergence, not as scope.
				const referenceDigests = (
					reference.manifest.range_digests ?? []
				).filter(
					(d) =>
						verifyDatasets.includes(d.dataset) &&
						d.from_block >= startHeight &&
						d.to_block <= tipHeight,
				);
				const divergentRanges: Array<{
					dataset: string;
					from_block: number;
					to_block: number;
				}> = [];
				for (const range of referenceDigests) {
					const actual = await computeRangeDigest(
						db,
						range.dataset,
						range.from_block,
						range.to_block,
					);
					if (
						actual.digest !== range.digest ||
						actual.row_count !== range.row_count
					) {
						divergentRanges.push({
							dataset: range.dataset,
							from_block: range.from_block,
							to_block: range.to_block,
						});
					}
				}
				const divergent = divergentRanges.length;

				// Hand the indexer its resume point. Without this the instance holds
				// millions of blocks while `index_progress` says nothing, and the
				// indexer's own `recomputeContiguous` cannot fix it — that is an
				// UPDATE, so with no row it silently no-ops and the instance looks
				// empty to every consumer that reads progress.
				const network = process.env.STACKS_NETWORK ?? "mainnet";
				await sql`
					INSERT INTO index_progress (
						network, last_indexed_block, last_contiguous_block,
						highest_seen_block, updated_at
					) VALUES (
						${network}, ${tipHeight}, ${tipHeight}, ${tipHeight}, NOW()
					)
					ON CONFLICT (network) DO UPDATE SET
						last_indexed_block = GREATEST(index_progress.last_indexed_block, EXCLUDED.last_indexed_block),
						last_contiguous_block = GREATEST(index_progress.last_contiguous_block, EXCLUDED.last_contiguous_block),
						highest_seen_block = GREATEST(index_progress.highest_seen_block, EXCLUDED.highest_seen_block),
						updated_at = NOW()
				`.execute(db);

				// Declare the scope. Without it an instance restored from a
				// forward-only archive reads as a chain missing its first N million
				// blocks; with it, that prefix is `out_of_scope` and the coverage
				// report stops crying gap over history nobody asked for.
				const genesisRow =
					startHeight === 0
						? await db
								.selectFrom("blocks")
								.select("hash")
								.where("canonical", "=", true)
								.where("height", "=", 0)
								.executeTakeFirst()
						: undefined;
				await upsertSyncScope(db, {
					network,
					start_height: startHeight,
					target_height: null,
					bootstrap: {
						source: "archive",
						manifest_digest: manifestDigest(reference.manifest),
						genesis_hash: genesisRow?.hash ?? null,
					},
				});

				const seam =
					nodeTipAtStart !== null && nodeTipAtStart > tipHeight
						? {
								nodeTip: nodeTipAtStart,
								gap: nodeTipAtStart - tipHeight,
							}
						: null;

				const elapsed = (Date.now() - startedAt) / 1000;
				const report = {
					status: divergent === 0 ? "restored" : "divergent",
					archive: reference.origin,
					start_height: startHeight,
					tip_height: tipHeight,
					rows: loaded,
					verified_datasets: verifyDatasets,
					ranges_verified: referenceDigests.length,
					divergent_ranges: divergent,
					divergent: divergentRanges,
					elapsed_seconds: Math.round(elapsed),
					resume_from: tipHeight + 1,
					node_tip_at_start: nodeTipAtStart,
					catch_up_blocks: seam?.gap ?? null,
					metered: quoteLine ?? null,
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
									`  verified ${referenceDigests.length} ${verifyDatasets.join("/")} ranges against the archive`,
								);
							} else {
								warn(
									"  archive published no digests for the restored range; the restore is unverified",
								);
							}
							console.error("");
							console.error(
								dim(
									`Your instance holds history through ${tipHeight.toLocaleString()} and will resume at ${(tipHeight + 1).toLocaleString()}.`,
								),
							);
							if (startHeight > 0) {
								console.error(
									dim(
										`  Scope starts at ${startHeight.toLocaleString()} — earlier history is declared out of scope, not missing.`,
									),
								);
							}
							if (seam) {
								// The chain kept moving during the restore. Naming the gap
								// is the difference between "start the indexer" and knowing
								// whether anything was missed.
								console.error(
									dim(
										`The chain advanced to ${seam.nodeTip.toLocaleString()} while restoring — ${seam.gap.toLocaleString()} blocks to catch up.`,
									),
								);
								console.error(
									dim(
										"  Start the indexer; it backfills that range before following the tip.",
									),
								);
							} else {
								console.error(
									dim(
										"  Start the indexer to continue from there. (Node unreachable — catch-up range unknown.)",
									),
								);
							}
						} else {
							const byDataset = verifyDatasets
								.map(
									(d) =>
										`${divergentRanges.filter((r) => r.dataset === d).length} ${d}`,
								)
								.join(", ");
							warn(
								`Restored ${loaded.blocks.toLocaleString()} blocks but ${divergent} ranges do not match the archive (${byDataset}).`,
							);
							console.error(
								dim(
									"  Investigate with: secondlayer verify --against <manifest>",
								),
							);
						}
					},
				});

				process.exit(
					divergent === 0 ? BOOTSTRAP_EXIT.OK : BOOTSTRAP_EXIT.INCOMPLETE,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (err instanceof ArchiveFetchError && err.transient) {
					// The network gave out, not the archive. Everything loaded so far
					// is on disk with its progress marker, so the remedy is a re-run,
					// and the exit code says "unfinished", not "refused".
					printError(message, {
						hint: "The archive could not be reached. Re-run the same command to resume; datasets already loaded are kept.",
					});
					process.exit(BOOTSTRAP_EXIT.INCOMPLETE);
				}
				const hint = /^--verify must be/.test(message)
					? "Pass --verify all (default) or --verify blocks."
					: /pointer|leave the archive root/.test(message)
						? "The archive pointer failed its integrity check. Pass --against the snapshot URL directly, and report this if the pointer is the official latest.json."
						: /failed verification/.test(message)
							? "An archive object does not match its signed digest. Re-download and retry."
							: /could not fetch/.test(message)
								? "Check the archive URL and your network connection."
								: "Set DATABASE_URL to the (empty) instance you want to bootstrap.";
				printError(message, { hint });
				process.exit(BOOTSTRAP_EXIT.REFUSED);
			}
		});
}

export function registerBootstrapCommand(program: Command): void {
	attachBootstrapCommand(
		program
			.command("bootstrap")
			.description(
				"Restore chain history from a verified archive instead of syncing from genesis",
			),
	);
}
