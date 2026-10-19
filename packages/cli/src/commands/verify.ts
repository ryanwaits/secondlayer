import { isArchiveDataset } from "@secondlayer/shared/archive/datasets";
import type { DigestIndexPartition } from "@secondlayer/shared/archive/per-height-digest";
import {
	type RangeComparison,
	type RangeDigest,
	compareRangeDigests,
	computeRangeDigest,
} from "@secondlayer/shared/archive/range-digest";
import type { PartitionSemanticDigest } from "@secondlayer/shared/archive/semantic-digest";
import {
	type PartitionSemanticComparison,
	comparePartitionSemanticDigests,
	computePartitionSemanticDigest,
} from "@secondlayer/shared/archive/semantic-digest-builder";
import {
	datasetMatchesTarget,
	parseVerifyTarget,
	reportVerify,
} from "@secondlayer/shared/coverage";
import { getDb } from "@secondlayer/shared/db";
import type { Command } from "commander";
import {
	type DivergentHeight,
	divergentHeightsForRange,
	mergeRepairRanges,
	sidecarNarrows,
} from "../lib/archive-heights.ts";
import {
	checkSignature,
	loadReference,
	resolveArchivePublicKey,
} from "../lib/archive-reference.ts";
import {
	dim,
	formatTable,
	green,
	note,
	output,
	printError,
	red,
	success,
	warn,
	yellow,
} from "../lib/output.ts";
import { isOssMode } from "../lib/resolve-auth.ts";
import { attachVerifyBlockCommand } from "./verify-block.ts";
import { attachVerifySubgraphCommand } from "./verify-subgraph.ts";

/**
 * `secondlayer verify` — compare local chain data against a signed archive manifest.
 *
 * The point of this command is that it is FREE, READ-ONLY, and FAST. Nothing
 * leaves the machine: the archive publishes digests, we compute the same
 * digests locally, and only those fixed-width strings are ever compared. An
 * operator can therefore run it against production data without an approval
 * conversation.
 *
 * It is fast because it verifies `blocks` by default (~0.5s per 50k heights,
 * measured on production), which is where every corruption we have actually
 * encountered lives: gaps, broken parent links, duplicate heights, and fork
 * points left on a losing branch. Digesting events instead would cost ~98s per
 * partition — hours to tell you the same thing.
 *
 * Exit codes are part of the contract, so this composes in CI:
 *   0  local data matches the reference
 *   1  divergence found (every divergent range is named)
 *   2  unanchored — the reference could not be fetched or its signature failed,
 *      so we can neither confirm nor deny. Deliberately NOT 0: "I couldn't
 *      check" must never read as "you're fine".
 */

export const VERIFY_EXIT = {
	CLEAN: 0,
	DIVERGED: 1,
	UNANCHORED: 2,
} as const;

function parseHeight(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`${flag} must be a non-negative integer, got "${value}"`);
	}
	return parsed;
}

/** Heights listed per divergent range in human output; --json has them all. */
const MAX_HEIGHTS_SHOWN = 20;

function statusLabel(status: RangeComparison["status"]): string {
	if (status === "match") return green("ok");
	if (status === "count-mismatch") return red("rows differ");
	if (status === "digest-mismatch") return red("data differs");
	return yellow("missing");
}

export function attachVerifyCommand(cmd: Command): Command {
	return (
		cmd
			.argument(
				"[target]",
				"all | raw (decode:<name> and subgraph:<name> have no archive digests yet)",
				"raw",
			)
			.option("--quick", "coverage/identity only (default)")
			.option("--deep", "include semantic / scratch replay where available")
			.option("--anchor", "require a verified archive signature")
			// Required, but checked in the action: Commander enforces a parent's
			// mandatory options on its subcommands too, and `verify block` has none.
			.option(
				"--against <manifest>",
				"archive manifest: an https URL or a local file path (required)",
			)
			.option("--from-block <n>", "first height to check")
			.option("--to-block <n>", "last height to check")
			.option("--counts", "also compare transaction/event row counts (slower)")
			.option(
				"--semantic",
				"also recompute per-partition semantic digests locally and compare (slow: full re-stream)",
			)
			.option(
				"--public-key <pem>",
				"pin a signing key; default is the archive key built into this release",
			)
			.option(
				"--insecure",
				"skip the manifest signature check (not recommended)",
			)
			.option("--json", "Output as JSON")
			.addHelpText(
				"after",
				`
Examples:
  $ secondlayer verify --against https://archive.secondlayer.tools/.../snapshots/<digest>.json
  $ secondlayer verify raw --against ./snapshot.json --from-block 8000000 --to-block 8499999
  $ secondlayer verify all --against ./snapshot.json --json
  $ secondlayer verify subgraph <name> --replay

Exit codes:
  0  local data matches the archive
  1  divergence found (divergent ranges are listed)
  2  unanchored — reference unavailable or unverifiable`,
			)
			.action(async (targetArg, opts, command: Command) => {
				if (opts.against === undefined)
					command.error(
						"error: required option '--against <manifest>' not specified",
						{
							code: "commander.missingMandatoryOptionValue",
						},
					);
				try {
					const target = parseVerifyTarget(targetArg);
					const mode = opts.deep ? "deep" : opts.anchor ? "anchor" : "quick";
					const fromBlock =
						opts.fromBlock === undefined
							? undefined
							: parseHeight(opts.fromBlock, "--from-block");
					const toBlock =
						opts.toBlock === undefined
							? undefined
							: parseHeight(opts.toBlock, "--to-block");
					if (
						fromBlock !== undefined &&
						toBlock !== undefined &&
						toBlock < fromBlock
					) {
						throw new Error("--to-block must be >= --from-block");
					}

					const publicKey = await resolveArchivePublicKey({
						explicitPem: opts.publicKey,
						envPem:
							process.env.ARCHIVE_SIGNING_PUBLIC_KEY ??
							process.env.STREAMS_SIGNING_PUBLIC_KEY,
						allowHostedApi: !isOssMode(),
					});
					const loaded = await loadReference(opts.against, {
						publicKeyPem: publicKey,
					});
					const { manifest, origin } = loaded;
					const signature = checkSignature(
						manifest,
						publicKey,
						!!opts.insecure,
					);

					if (!signature.verified && !opts.insecure) {
						printError(`Cannot trust the reference: ${signature.reason}.`, {
							hint: "Pass --public-key <pem> to pin a key, or --insecure to compare anyway (result is unverified).",
						});
						output({
							json: opts.json,
							data: {
								...reportVerify({
									target,
									mode,
									anchored: false,
									detail: signature.reason,
								}),
								status: "unanchored",
								reference: origin,
								reason: signature.reason,
							},
							human: () => {},
						});
						process.exit(VERIFY_EXIT.UNANCHORED);
					}

					const unanchoredJson = (detail: string) =>
						output({
							json: opts.json,
							data: {
								...reportVerify({ target, mode, anchored: false, detail }),
								status: "unanchored",
								reference: origin,
								reason: detail,
							},
							human: () => {},
						});

					// Tell "the archive has no such dataset" apart from "range not covered".
					const published = (manifest.range_digests ?? []).filter((d) =>
						datasetMatchesTarget(d.dataset, target),
					);
					if (published.length === 0) {
						const label =
							target.kind === "decode"
								? `decode:${target.name}`
								: target.kind === "subgraph"
									? `subgraph:${target.name}`
									: target.kind;
						const datasets = [
							...new Set((manifest.range_digests ?? []).map((d) => d.dataset)),
						].sort();
						const hint =
							target.kind === "decode"
								? "Check the events decoders read from with: secondlayer verify raw --against <manifest>"
								: target.kind === "subgraph"
									? "Recompute a state subgraph's rows with: secondlayer verify subgraph <name> --replay"
									: "Check the manifest you passed to --against.";
						printError(
							`This archive publishes no digests for ${label}. It has: ${datasets.join(", ") || "none"}.`,
							{ hint },
						);
						unanchoredJson("no digests");
						process.exit(VERIFY_EXIT.UNANCHORED);
					}

					const reference = published.filter((d) => {
						if (fromBlock !== undefined && d.to_block < fromBlock) return false;
						if (toBlock !== undefined && d.from_block > toBlock) return false;
						return true;
					});
					if (reference.length === 0) {
						printError("The reference publishes no digests for that range.", {
							hint: "Check --from-block/--to-block against the manifest's coverage.",
						});
						unanchoredJson("no digests for that range");
						process.exit(VERIFY_EXIT.UNANCHORED);
					}

					const db = getDb();
					const local: RangeDigest[] = [];
					let checked = 0;
					for (const range of reference) {
						local.push(
							await computeRangeDigest(
								db,
								range.dataset,
								range.from_block,
								range.to_block,
							),
						);
						checked++;
						if (checked % 25 === 0 || checked === reference.length) {
							note(`  checked ${checked}/${reference.length} ranges`);
						}
					}

					const comparisons = compareRangeDigests(local, reference);

					// Row counts are opt-in: on a full chain this is minutes rather than
					// the ~90s the digest pass costs, and it rarely says anything the
					// block digests did not already say.
					const countChecks: RangeComparison[] = [];
					if (opts.counts && manifest.partitions) {
						for (const partition of manifest.partitions) {
							// A dataset this release does not know (a newer archive's) is
							// skipped, never counted against another dataset's table.
							if (!isArchiveDataset(partition.dataset)) continue;
							if (partition.dataset === "blocks") continue;
							if (fromBlock !== undefined && partition.to_block < fromBlock)
								continue;
							if (toBlock !== undefined && partition.from_block > toBlock)
								continue;
							const actual = await computeRangeDigest(
								db,
								partition.dataset,
								partition.from_block,
								partition.to_block,
							);
							countChecks.push({
								dataset: partition.dataset,
								from_block: partition.from_block,
								to_block: partition.to_block,
								status:
									actual.row_count === partition.row_count
										? "match"
										: "count-mismatch",
								expected_digest: null,
								actual_digest: null,
								expected_rows: partition.row_count,
								actual_rows: actual.row_count,
							});
						}
					}

					const semanticChecks: PartitionSemanticComparison[] = [];
					const referenceSemantic: PartitionSemanticDigest[] = (
						manifest.partition_semantic_digests ?? []
					).filter((d) => {
						if (!isArchiveDataset(d.dataset)) return false;
						if (!datasetMatchesTarget(d.dataset, target)) return false;
						if (fromBlock !== undefined && d.to_block < fromBlock) return false;
						if (toBlock !== undefined && d.from_block > toBlock) return false;
						return true;
					});
					if (opts.semantic || opts.deep) {
						if (referenceSemantic.length === 0) {
							warn(
								"Reference publishes no semantic digests; --semantic had nothing to compare.",
							);
						} else {
							note(
								`Recomputing ${referenceSemantic.length} partition semantic digests (this is the slow pass).`,
							);
							const localSemantic: PartitionSemanticDigest[] = [];
							let semanticDone = 0;
							for (const partition of referenceSemantic) {
								localSemantic.push(
									await computePartitionSemanticDigest(
										db,
										partition.dataset,
										partition.from_block,
										partition.to_block,
									),
								);
								semanticDone++;
								if (
									semanticDone % 5 === 0 ||
									semanticDone === referenceSemantic.length
								) {
									note(
										`  checked ${semanticDone}/${referenceSemantic.length} partitions`,
									);
								}
							}
							semanticChecks.push(
								...comparePartitionSemanticDigests(
									localSemantic,
									referenceSemantic,
								),
							);
						}
					}

					const all = [
						...comparisons,
						...countChecks,
						...semanticChecks.map((s) => ({
							dataset: s.dataset,
							from_block: s.from_block,
							to_block: s.to_block,
							status: s.status,
							expected_digest: s.expected_digest,
							actual_digest: s.actual_digest,
							expected_rows: s.expected_rows,
							actual_rows: s.actual_rows,
						})),
					];
					const diverged: Array<
						(typeof all)[number] & { divergent_heights?: DivergentHeight[] }
					> = all.filter((c) => c.status !== "match");

					// Narrow each divergent range to exact heights from the archive's
					// per-height sidecars (free, read from the reference root).
					const digestIndex = manifest.digest_index as
						| DigestIndexPartition[]
						| undefined;
					const heightNotes: string[] = [];
					if (diverged.length > 0 && !digestIndex?.length) {
						heightNotes.push(
							"This snapshot has no per-height digests; exact diverging heights need a newer snapshot.",
						);
					} else {
						for (const range of diverged) {
							if (!sidecarNarrows(range.dataset)) {
								heightNotes.push(
									`${range.dataset} ${range.from_block}-${range.to_block} is checked as a whole range: per-height digests carry no ${range.dataset} part.`,
								);
								continue;
							}
							try {
								const heights = await divergentHeightsForRange({
									db,
									reference: loaded,
									digestIndex,
									dataset: range.dataset,
									fromBlock: range.from_block,
									toBlock: range.to_block,
								});
								if (heights) range.divergent_heights = heights;
								else
									heightNotes.push(
										`No per-height digests cover ${range.from_block}-${range.to_block}.`,
									);
							} catch (err) {
								heightNotes.push(
									`Could not narrow ${range.from_block}-${range.to_block} to heights: ${err instanceof Error ? err.message : String(err)}`,
								);
							}
						}
					}
					const verdict = reportVerify({
						target,
						mode,
						diverged: diverged.length > 0,
					});
					const report = {
						...verdict,
						status: verdict.status,
						reference: origin,
						signature_verified: signature.verified,
						ranges_checked: all.length,
						semantic_checks: semanticChecks.length,
						divergent_ranges: diverged,
						...(heightNotes.length > 0 ? { note: heightNotes.join(" ") } : {}),
					};

					output({
						json: opts.json,
						data: report,
						human: () => {
							if (diverged.length === 0) {
								success(
									`Local data matches the archive across ${all.length} ranges.`,
								);
								note(
									signature.verified
										? "  reference signature verified"
										: "  reference signature NOT verified (--insecure)",
								);
								return;
							}
							warn(
								`${diverged.length} of ${all.length} ranges diverge from the archive.`,
							);
							console.error("");
							console.error(
								formatTable(
									["RANGE", "DATASET", "STATUS", "EXPECTED", "LOCAL"],
									diverged.map((d) => [
										`${d.from_block}-${d.to_block}`,
										d.dataset,
										statusLabel(d.status),
										String(d.expected_rows),
										String(d.actual_rows),
									]),
								),
							);
							for (const range of diverged) {
								const heights = range.divergent_heights;
								if (!heights) continue;
								console.error("");
								console.error(
									`${range.from_block}-${range.to_block} ${range.dataset}: ${heights.length} diverging height${heights.length === 1 ? "" : "s"}`,
								);
								for (const h of heights.slice(0, MAX_HEIGHTS_SHOWN)) {
									console.error(`  ${h.height}  ${h.parts.join(", ")}`);
								}
								if (heights.length > MAX_HEIGHTS_SHOWN) {
									console.error(
										dim(
											`  and ${heights.length - MAX_HEIGHTS_SHOWN} more (see --json)`,
										),
									);
								}
							}
							if (heightNotes.length > 0) {
								console.error("");
								for (const line of heightNotes) console.error(dim(`  ${line}`));
							}
							console.error("");
							console.error(
								dim(
									"These ranges hold different data than the signed archive. Repair with:",
								),
							);
							for (const range of mergeRepairRanges(diverged)) {
								console.error(
									dim(
										`  secondlayer repair --from-block ${range.from_block} --to-block ${range.to_block}`,
									),
								);
							}
						},
					});

					process.exit(
						diverged.length === 0 ? VERIFY_EXIT.CLEAN : VERIFY_EXIT.DIVERGED,
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const hint = /pointer|leave the archive root/.test(message)
						? "The archive pointer failed its integrity check. Pass --against the snapshot URL directly, and report this if the pointer is the official latest.json."
						: /could not fetch/.test(message)
							? "Check the archive URL and your network connection."
							: "Set DATABASE_URL to the instance you want to verify.";
					printError(message, { hint });
					process.exit(VERIFY_EXIT.UNANCHORED);
				}
			})
	);
}

export function registerVerifyCommand(program: Command): void {
	const verify = attachVerifyCommand(
		program
			.command("verify")
			.description(
				"Compare local chain data against a signed archive, prove one block with `verify block`, or recompute a subgraph with `verify subgraph --replay` (read-only)",
			),
	);
	attachVerifyBlockCommand(verify);
	attachVerifySubgraphCommand(verify);
}
