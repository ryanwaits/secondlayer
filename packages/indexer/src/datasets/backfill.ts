#!/usr/bin/env bun
/**
 * Datasets historical backfill — walk fixed block ranges and run the
 * dataset exporter for each. Uploads to R2 by default; pass --no-upload
 * for a dry-run that writes parquet files locally only.
 *
 * Usage:
 *   bun run packages/indexer/src/datasets/backfill.ts <slug> \
 *     --from <block> --to <block> [--no-upload] [--force]
 *
 * Slugs: stx-transfers, sbtc-events, sbtc-token-events,
 *        pox-4-calls, bns-name-events, bns-namespace-events,
 *        bns-marketplace-events
 *
 * Range size is fixed at DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS (10k).
 * --from/--to are inclusive block heights; the script aligns them down to
 * the nearest range boundary.
 */
import { readIndexerProducerVersion } from "../streams-bulk/config.ts";
import {
	DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
	DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
} from "../streams-bulk/range.ts";
import { bnsMarketplaceEventsExporterSpec } from "./bns/marketplace-events/exporter.ts";
import { bnsNameEventsExporterSpec } from "./bns/name-events/exporter.ts";
import { bnsNamespaceEventsExporterSpec } from "./bns/namespace-events/exporter.ts";
import { pox4CallsExporterSpec } from "./pox-4/calls/exporter.ts";
import { sbtcEventsExporterSpec } from "./sbtc/events/exporter.ts";
import { sbtcTokenEventsExporterSpec } from "./sbtc/token-events/exporter.ts";
import { stxTransfersExporterSpec } from "./stx-transfers/exporter.ts";
import type {
	DatasetExporterSpec,
	DatasetRowWithCursor,
} from "./_shared/exporter.ts";
import { exportDatasetRange } from "./_shared/exporter.ts";
import { DEFAULT_DATASETS_PREFIX } from "./_shared/paths.ts";

const REGISTRY = {
	"stx-transfers": stxTransfersExporterSpec,
	"sbtc-events": sbtcEventsExporterSpec,
	"sbtc-token-events": sbtcTokenEventsExporterSpec,
	"pox-4-calls": pox4CallsExporterSpec,
	"bns-name-events": bnsNameEventsExporterSpec,
	"bns-namespace-events": bnsNamespaceEventsExporterSpec,
	"bns-marketplace-events": bnsMarketplaceEventsExporterSpec,
} as const;

type Slug = keyof typeof REGISTRY;

function parseArgs(argv: string[]): {
	slug: Slug;
	fromBlock: number;
	toBlock: number;
	upload: boolean;
	force: boolean;
} {
	const [, , slug, ...rest] = argv;
	if (!slug || !(slug in REGISTRY)) {
		throw new Error(
			`First argument must be a dataset slug. Valid: ${Object.keys(REGISTRY).join(", ")}`,
		);
	}
	const flags = new Map<string, string | true>();
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (!arg.startsWith("--")) continue;
		const next = rest[i + 1];
		if (next && !next.startsWith("--")) {
			flags.set(arg.slice(2), next);
			i++;
		} else {
			flags.set(arg.slice(2), true);
		}
	}
	const from = Number(flags.get("from"));
	const to = Number(flags.get("to"));
	if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
		throw new Error("--from and --to are required integer block heights, --from <= --to");
	}
	return {
		slug: slug as Slug,
		fromBlock: from,
		toBlock: to,
		upload: flags.get("no-upload") !== true,
		force: flags.get("force") === true,
	};
}

async function main() {
	const opts = parseArgs(process.argv);
	const spec = REGISTRY[opts.slug] as unknown as DatasetExporterSpec<DatasetRowWithCursor>;
	const rangeSize = DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS;

	const firstRangeStart = alignDownToRange(opts.fromBlock, rangeSize);
	const lastRangeStart = alignDownToRange(opts.toBlock, rangeSize);
	const totalRanges = (lastRangeStart - firstRangeStart) / rangeSize + 1;
	const network = process.env.STREAMS_BULK_NETWORK ?? "mainnet";
	const prefix = process.env.DATASETS_PREFIX ?? DEFAULT_DATASETS_PREFIX;
	const outputDir = process.env.DATASETS_OUTPUT_DIR ?? "tmp/datasets";
	const producerVersion = await readIndexerProducerVersion();

	console.log(
		`Backfilling ${opts.slug}: ${totalRanges} ranges of ${rangeSize} blocks from ${firstRangeStart} to ${lastRangeStart + rangeSize - 1}`,
	);
	console.log(`  upload=${opts.upload} force=${opts.force}`);

	let exported = 0;
	let skipped = 0;
	for (
		let rangeStart = firstRangeStart;
		rangeStart <= lastRangeStart;
		rangeStart += rangeSize
	) {
		const range = {
			fromBlock: rangeStart,
			toBlock: rangeStart + rangeSize - 1,
		};
		try {
			const result = await exportDatasetRange(spec, {
				range,
				network,
				prefix,
				outputDir,
				finalityLagBlocks: DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
				producerVersion,
				upload: opts.upload,
				force: opts.force,
			});
			exported += 1;
			console.log(
				`  ✓ ${range.fromBlock}..${range.toBlock} rows=${result.rowCount} uploaded=${result.uploaded}`,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!opts.force && msg.includes("refusing to overwrite")) {
				skipped += 1;
				console.log(`  ⊘ ${range.fromBlock}..${range.toBlock} skipped (already published)`);
				continue;
			}
			console.error(
				`  ✗ ${range.fromBlock}..${range.toBlock} failed: ${msg}`,
			);
			throw err;
		}
	}
	console.log(
		`Done: exported=${exported} skipped=${skipped} total=${totalRanges}`,
	);
}

function alignDownToRange(block: number, rangeSize: number): number {
	return Math.floor(block / rangeSize) * rangeSize;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
