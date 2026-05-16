import { logger } from "@secondlayer/shared/logger";
import { readIndexerProducerVersion } from "../../streams-bulk/config.ts";
import { getLatestCanonicalBlockHeight } from "../../streams-bulk/query.ts";
import {
	DEFAULT_STREAMS_BULK_FINALITY_LAG_BLOCKS,
	DEFAULT_STREAMS_BULK_RANGE_SIZE_BLOCKS,
	type StreamsBulkBlockRange,
	latestCompleteFinalizedRange,
} from "../../streams-bulk/range.ts";
import {
	type DatasetExporterSpec,
	type DatasetRowWithCursor,
	type ExportDatasetRangeResult,
	exportDatasetRange,
} from "./exporter.ts";
import {
	DEFAULT_DATASETS_PREFIX,
	datasetParquetObjectPath,
} from "./paths.ts";
import {
	createDatasetsS3Client,
	getDatasetsR2ConfigFromEnv,
	objectExists,
} from "./upload.ts";

export type DatasetPublisherState = {
	enabled: boolean;
	lastTickAt: number;
	lastPublishedRange: StreamsBulkBlockRange | null;
	lastPublishedAt: number;
	publishedTotal: number;
	lastError: string | null;
};

export type DatasetPublisherSpec<Row extends DatasetRowWithCursor> = {
	exporter: DatasetExporterSpec<Row>;
	/** Env var name that gates the publisher (e.g. SBTC_PUBLISHER_ENABLED). */
	enabledEnv: string;
	/** Env var name for the tick interval override (optional). */
	intervalMsEnv: string;
	/** Default interval if intervalMsEnv unset. */
	defaultIntervalMs?: number;
	/** Human label used in log lines (e.g. "sBTC events"). */
	label: string;
};

export type StartDatasetPublisherOptions = {
	intervalMs?: number;
};

export type DatasetPublisher = {
	state: DatasetPublisherState;
	start: (options?: StartDatasetPublisherOptions) => () => void;
	publishNextEligibleRange: () => Promise<StreamsBulkBlockRange | null>;
};

const DEFAULT_PUBLISHER_INTERVAL_MS = 60_000;

export function createDatasetPublisher<Row extends DatasetRowWithCursor>(
	spec: DatasetPublisherSpec<Row>,
): DatasetPublisher {
	const state: DatasetPublisherState = {
		enabled: false,
		lastTickAt: 0,
		lastPublishedRange: null,
		lastPublishedAt: 0,
		publishedTotal: 0,
		lastError: null,
	};

	async function publishNextEligibleRange(): Promise<StreamsBulkBlockRange | null> {
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
			logger.debug(`${spec.label} publisher: no canonical blocks yet`);
			return null;
		}
		const range = latestCompleteFinalizedRange({
			tipBlockHeight: tipHeight,
			rangeSizeBlocks,
			finalityLagBlocks,
		});
		if (!range) {
			logger.debug(`${spec.label} publisher: no eligible finalized range`, {
				tipHeight,
			});
			return null;
		}

		const r2Config = getDatasetsR2ConfigFromEnv();
		const client = createDatasetsS3Client(r2Config);
		const parquetKey = datasetParquetObjectPath(
			prefix,
			spec.exporter.dataset,
			range,
		);
		if (
			await objectExists({ client, bucket: r2Config.bucket, key: parquetKey })
		) {
			logger.debug(`${spec.label} publisher: latest range already published`, {
				range,
			});
			return null;
		}

		logger.info(`${spec.label} publisher: exporting range`, {
			range,
			tipHeight,
		});
		const result: ExportDatasetRangeResult = await exportDatasetRange(
			spec.exporter,
			{
				range,
				network,
				prefix,
				outputDir,
				finalityLagBlocks,
				producerVersion: await readIndexerProducerVersion(),
				upload: true,
				force: false,
			},
		);
		state.lastPublishedRange = result.range;
		state.lastPublishedAt = Date.now();
		state.publishedTotal += 1;
		logger.info(`${spec.label} publisher: published range`, {
			range: result.range,
			rowCount: result.rowCount,
			parquetObjectPath: result.parquetObjectPath,
		});
		return result.range;
	}

	function start(options: StartDatasetPublisherOptions = {}): () => void {
		const enabled = process.env[spec.enabledEnv] === "true";
		if (!enabled) {
			logger.info(`${spec.label} publisher disabled`);
			return () => {};
		}

		const intervalMs =
			options.intervalMs ??
			parseIntervalMsEnv(
				spec.intervalMsEnv,
				spec.defaultIntervalMs ?? DEFAULT_PUBLISHER_INTERVAL_MS,
			);

		state.enabled = true;
		logger.info(`Starting ${spec.label} publisher`, { intervalMs });

		let running = false;
		let stopped = false;

		async function tick() {
			if (running || stopped) return;
			running = true;
			state.lastTickAt = Date.now();
			try {
				await publishNextEligibleRange();
				state.lastError = null;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				state.lastError = message;
				logger.error(`${spec.label} publisher tick failed`, { error: err });
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
			state.enabled = false;
			logger.info(`${spec.label} publisher stopped`);
		};
	}

	return { state, start, publishNextEligibleRange };
}

function parseIntervalMsEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
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
