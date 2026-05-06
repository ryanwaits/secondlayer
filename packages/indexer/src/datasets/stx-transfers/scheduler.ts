import { logger } from "@secondlayer/shared/logger";
import { readIndexerProducerVersion } from "../../streams-bulk/config.ts";
import {
	type StreamsBulkBlockRange,
	DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
	DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
	latestCompleteFinalizedRange,
} from "../../streams-bulk/range.ts";
import { getLatestCanonicalBlockHeight } from "../../streams-bulk/query.ts";
import {
	DEFAULT_DATASETS_PREFIX,
	datasetParquetObjectPath,
} from "../_shared/paths.ts";
import {
	createDatasetsS3Client,
	getDatasetsR2ConfigFromEnv,
	objectExists,
} from "../_shared/upload.ts";
import { exportStxTransfersRange } from "./exporter.ts";
import { STX_TRANSFERS_DATASET } from "./schema.ts";

export type StxTransfersPublisherState = {
	enabled: boolean;
	lastTickAt: number;
	lastPublishedRange: StreamsBulkBlockRange | null;
	lastPublishedAt: number;
	publishedTotal: number;
	lastError: string | null;
};

export const stxTransfersPublisherState: StxTransfersPublisherState = {
	enabled: false,
	lastTickAt: 0,
	lastPublishedRange: null,
	lastPublishedAt: 0,
	publishedTotal: 0,
	lastError: null,
};

const DEFAULT_PUBLISHER_INTERVAL_MS = 60_000;

export type StartStxTransfersPublisherOptions = {
	intervalMs?: number;
};

export function startStxTransfersPublisher(
	options: StartStxTransfersPublisherOptions = {},
): () => void {
	const enabled = process.env.STX_TRANSFERS_PUBLISHER_ENABLED === "true";
	if (!enabled) {
		logger.info("STX transfers publisher disabled");
		return () => {};
	}

	const intervalMs =
		options.intervalMs ?? parseIntervalMsEnv(DEFAULT_PUBLISHER_INTERVAL_MS);

	stxTransfersPublisherState.enabled = true;
	logger.info("Starting STX transfers publisher", { intervalMs });

	let running = false;
	let stopped = false;

	async function tick() {
		if (running || stopped) return;
		running = true;
		stxTransfersPublisherState.lastTickAt = Date.now();
		try {
			await publishNextEligibleRange();
			stxTransfersPublisherState.lastError = null;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			stxTransfersPublisherState.lastError = message;
			logger.error("STX transfers publisher tick failed", { error: err });
		} finally {
			running = false;
		}
	}

	const timer = setInterval(() => {
		void tick();
	}, intervalMs);
	void tick();

	return () => {
		stopped = true;
		clearInterval(timer);
		stxTransfersPublisherState.enabled = false;
		logger.info("STX transfers publisher stopped");
	};
}

export async function publishNextEligibleRange(): Promise<
	StreamsBulkBlockRange | null
> {
	const network = process.env.STREAMS_BULK_NETWORK ?? "mainnet";
	const prefix = process.env.DATASETS_PREFIX ?? DEFAULT_DATASETS_PREFIX;
	const outputDir = process.env.DATASETS_OUTPUT_DIR ?? "tmp/datasets";
	const rangeSizeBlocks = parseIntegerEnv(
		"STREAMS_BULK_RANGE_SIZE_BLOCKS",
		DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
	);
	const finalityLagBlocks = parseIntegerEnv(
		"STREAMS_BULK_FINALITY_LAG_BLOCKS",
		DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
	);

	const tipHeight = await getLatestCanonicalBlockHeight();
	if (tipHeight === null) {
		logger.debug("STX transfers publisher: no canonical blocks yet");
		return null;
	}
	const range = latestCompleteFinalizedRange({
		tipBlockHeight: tipHeight,
		rangeSizeBlocks,
		finalityLagBlocks,
	});
	if (!range) {
		logger.debug("STX transfers publisher: no eligible finalized range", {
			tipHeight,
		});
		return null;
	}

	const r2Config = getDatasetsR2ConfigFromEnv();
	const client = createDatasetsS3Client(r2Config);
	const parquetKey = datasetParquetObjectPath(
		prefix,
		STX_TRANSFERS_DATASET,
		range,
	);
	if (
		await objectExists({ client, bucket: r2Config.bucket, key: parquetKey })
	) {
		logger.debug("STX transfers publisher: latest range already published", {
			range,
		});
		return null;
	}

	logger.info("STX transfers publisher: exporting range", { range, tipHeight });
	const result = await exportStxTransfersRange({
		range,
		network,
		prefix,
		outputDir,
		finalityLagBlocks,
		producerVersion: await readIndexerProducerVersion(),
		upload: true,
		force: false,
	});
	stxTransfersPublisherState.lastPublishedRange = result.range;
	stxTransfersPublisherState.lastPublishedAt = Date.now();
	stxTransfersPublisherState.publishedTotal += 1;
	logger.info("STX transfers publisher: published range", {
		range: result.range,
		rowCount: result.rowCount,
		parquetObjectPath: result.parquetObjectPath,
	});
	return result.range;
}

function parseIntervalMsEnv(fallback: number): number {
	const raw = process.env.STX_TRANSFERS_PUBLISHER_INTERVAL_MS;
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			"STX_TRANSFERS_PUBLISHER_INTERVAL_MS must be a positive integer",
		);
	}
	return parsed;
}

function parseIntegerEnv(name: string, fallback: number): number {
	const value = process.env[name];
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed)) {
		throw new Error(`${name} must be an integer`);
	}
	return parsed;
}
