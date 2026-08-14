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
	checkSignature,
	loadReference,
	resolvePublicKey,
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

/**
 * `sl verify` — compare local chain data against a signed archive manifest.
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

function statusLabel(status: RangeComparison["status"]): string {
	if (status === "match") return green("ok");
	if (status === "count-mismatch") return red("rows differ");
	if (status === "digest-mismatch") return red("data differs");
	return yellow("missing");
}

export function registerVerifyCommand(program: Command): void {
	program
		.command("verify")
		.description(
			"Compare local chain data against a signed archive (read-only; nothing is uploaded)",
		)
		.argument("[target]", "all | raw | decode:<name> | subgraph:<name>", "raw")
		.option("--quick", "coverage/identity only (default)")
		.option("--deep", "include semantic / scratch replay where available")
		.option("--anchor", "require a verified archive signature")
		.requiredOption(
			"--against <manifest>",
			"archive manifest: an https URL or a local file path",
		)
		.option("--from-block <n>", "first height to check")
		.option("--to-block <n>", "last height to check")
		.option("--counts", "also compare transaction/event row counts (slower)")
		.option(
			"--semantic",
			"also recompute per-partition semantic digests locally and compare (slow: full re-stream)",
		)
		.option("--public-key <pem>", "pin the signing key instead of fetching it")
		.option("--insecure", "skip the manifest signature check (not recommended)")
		.option("--json", "Output as JSON")
		.addHelpText(
			"after",
			`
Examples:
  $ sl verify --against https://archive.secondlayer.tools/.../snapshots/<digest>.json
  $ sl verify raw --against ./snapshot.json --from-block 8000000 --to-block 8499999
  $ sl verify all --against ./snapshot.json --json
  $ sl verify decode:ft_transfer --against ./snapshot.json --quick
  $ sl verify subgraph:sbtc --against ./snapshot.json --deep

Exit codes:
  0  local data matches the archive
  1  divergence found (divergent ranges are listed)
  2  unanchored — reference unavailable or unverifiable`,
		)
		.action(async (targetArg, opts) => {
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

				const { manifest, origin } = await loadReference(opts.against);
				const publicKey = await resolvePublicKey(
					opts.publicKey,
					process.env.SL_API_URL ?? "https://api.secondlayer.tools",
				);
				const signature = checkSignature(manifest, publicKey, !!opts.insecure);

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

				const reference = (manifest.range_digests ?? []).filter((d) => {
					if (!datasetMatchesTarget(d.dataset, target)) return false;
					if (fromBlock !== undefined && d.to_block < fromBlock) return false;
					if (toBlock !== undefined && d.from_block > toBlock) return false;
					return true;
				});
				if (reference.length === 0) {
					printError("The reference publishes no digests for that range.", {
						hint: "Check --from-block/--to-block against the manifest's coverage.",
					});
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
						if (partition.dataset === "blocks") continue;
						if (fromBlock !== undefined && partition.to_block < fromBlock)
							continue;
						if (toBlock !== undefined && partition.from_block > toBlock)
							continue;
						const actual = await computeRangeDigest(
							db,
							partition.dataset as RangeDigest["dataset"],
							partition.from_block,
							partition.to_block,
						);
						countChecks.push({
							dataset: partition.dataset as RangeDigest["dataset"],
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
					if (fromBlock !== undefined && d.to_block < fromBlock) return false;
					if (toBlock !== undefined && d.from_block > toBlock) return false;
					return true;
				});
				if (opts.semantic) {
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
				const diverged = all.filter((c) => c.status !== "match");
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
						console.error("");
						console.error(
							dim(
								"These ranges hold different data than the signed archive. Repair with:",
							),
						);
						const first = diverged[0];
						if (first) {
							console.error(
								dim(
									`  sl repair --from-block ${first.from_block} --to-block ${first.to_block}`,
								),
							);
						}
					},
				});

				process.exit(
					diverged.length === 0 ? VERIFY_EXIT.CLEAN : VERIFY_EXIT.DIVERGED,
				);
			} catch (err) {
				printError(err instanceof Error ? err.message : String(err), {
					hint: "Set DATABASE_URL to the instance you want to verify.",
				});
				process.exit(VERIFY_EXIT.UNANCHORED);
			}
		});
}
