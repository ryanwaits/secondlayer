import { finalizedBurnHeight } from "@secondlayer/shared";
import { logger } from "@secondlayer/shared/logger";
import {
	getCurrentCanonicalTip,
	getFinalizedStacksHeight,
} from "../streams-tip.ts";
import {
	getStreamsBulkRuntimeConfigFromEnv,
	readIndexerProducerVersion,
} from "./config.ts";
import { exportStreamsBulkRange } from "./exporter.ts";
import { streamsBulkParquetObjectPath } from "./paths.ts";
import {
	type StreamsBulkBlockRange,
	finalizedRangeFromHeight,
} from "./range.ts";
import {
	createStreamsBulkS3Client,
	getStreamsBulkR2ConfigFromEnv,
	objectExists,
} from "./upload.ts";

export type StreamsBulkPublisherState = {
	enabled: boolean;
	lastTickAt: number;
	lastPublishedRange: StreamsBulkBlockRange | null;
	lastPublishedAt: number;
	publishedTotal: number;
	lastError: string | null;
};

export const streamsBulkPublisherState: StreamsBulkPublisherState = {
	enabled: false,
	lastTickAt: 0,
	lastPublishedRange: null,
	lastPublishedAt: 0,
	publishedTotal: 0,
	lastError: null,
};

const DEFAULT_PUBLISHER_INTERVAL_MS = 60_000;

export type StartStreamsBulkPublisherOptions = {
	intervalMs?: number;
};

export function startStreamsBulkPublisher(
	options: StartStreamsBulkPublisherOptions = {},
): () => void {
	const enabled = process.env.STREAMS_BULK_PUBLISHER_ENABLED === "true";
	if (!enabled) {
		logger.info("Streams bulk publisher disabled");
		return () => {};
	}

	const intervalMs =
		options.intervalMs ?? parseIntervalMsEnv(DEFAULT_PUBLISHER_INTERVAL_MS);

	streamsBulkPublisherState.enabled = true;
	logger.info("Starting streams bulk publisher", { intervalMs });

	let running = false;
	let stopped = false;

	async function tick() {
		if (running || stopped) return;
		running = true;
		streamsBulkPublisherState.lastTickAt = Date.now();
		try {
			await publishNextEligibleRange();
			streamsBulkPublisherState.lastError = null;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			streamsBulkPublisherState.lastError = message;
			logger.error("Streams bulk publisher tick failed", { error: err });
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
		streamsBulkPublisherState.enabled = false;
		logger.info("Streams bulk publisher stopped");
	};
}

export async function publishNextEligibleRange(): Promise<StreamsBulkBlockRange | null> {
	const config = getStreamsBulkRuntimeConfigFromEnv();
	const tip = await getCurrentCanonicalTip();
	if (tip === null) {
		logger.debug("Streams bulk publisher: no canonical blocks yet");
		return null;
	}
	const finalizedHeight = await getFinalizedStacksHeight(
		finalizedBurnHeight(tip.burn_block_height, config.btcConfirmations),
	);
	const range = finalizedRangeFromHeight({
		finalizedHeight,
		rangeSizeBlocks: config.rangeSizeBlocks,
	});
	if (!range) {
		logger.debug("Streams bulk publisher: no eligible finalized range", {
			tipHeight: tip.block_height,
			finalizedHeight,
		});
		return null;
	}
	const finalityLagBlocks = tip.block_height - finalizedHeight;

	const r2Config = getStreamsBulkR2ConfigFromEnv();
	const client = createStreamsBulkS3Client(r2Config);
	const parquetKey = streamsBulkParquetObjectPath(config.prefix, range);
	if (
		await objectExists({ client, bucket: r2Config.bucket, key: parquetKey })
	) {
		logger.debug("Streams bulk publisher: latest range already published", {
			range,
		});
		return null;
	}

	logger.info("Streams bulk publisher: exporting range", {
		range,
		tipHeight: tip.block_height,
		finalizedHeight,
	});
	const result = await exportStreamsBulkRange({
		range,
		network: config.network,
		prefix: config.prefix,
		outputDir: config.outputDir,
		finalityLagBlocks,
		producerVersion: await readIndexerProducerVersion(),
		upload: true,
		force: false,
	});
	streamsBulkPublisherState.lastPublishedRange = result.range;
	streamsBulkPublisherState.lastPublishedAt = Date.now();
	streamsBulkPublisherState.publishedTotal += 1;
	logger.info("Streams bulk publisher: published range", {
		range: result.range,
		rowCount: result.rowCount,
		parquetObjectPath: result.parquetObjectPath,
	});
	return result.range;
}

function parseIntervalMsEnv(fallback: number): number {
	const raw = process.env.STREAMS_BULK_PUBLISHER_INTERVAL_MS;
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(
			"STREAMS_BULK_PUBLISHER_INTERVAL_MS must be a positive integer",
		);
	}
	return parsed;
}
