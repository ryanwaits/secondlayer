import { closeDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import { consumeFtTransferDecodedEvents } from "./decoder.ts";
import { getL2DecoderHealth } from "./health.ts";

const PORT = Number.parseInt(process.env.PORT || "3710", 10);
const controller = new AbortController();
let decodedTotal = 0;
let decodedThisMinute = 0;

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return;
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

async function logProgress(): Promise<void> {
	try {
		const health = await getL2DecoderHealth();
		logger.info("l2_decoder.progress", {
			decoder: health.decoder,
			writes_per_minute: decodedThisMinute,
			decoded_total: decodedTotal,
			lag_seconds: health.lag_seconds,
			checkpoint: health.checkpoint,
			status: health.status,
		});
		decodedThisMinute = 0;
	} catch (error) {
		logger.warn("l2_decoder.progress_failed", { error: String(error) });
	}
}

async function runDecoder(): Promise<void> {
	while (!controller.signal.aborted) {
		const before = decodedTotal;
		try {
			await consumeFtTransferDecodedEvents({
				batchSize: Number.parseInt(
					process.env.L2_DECODER_BATCH_SIZE ?? "500",
					10,
				),
				emptyBackoffMs: Number.parseInt(
					process.env.L2_DECODER_EMPTY_BACKOFF_MS ?? "1000",
					10,
				),
				signal: controller.signal,
				onProgress: ({ decoded }) => {
					decodedTotal += decoded;
					decodedThisMinute += decoded;
				},
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			logger.error("l2_decoder.error", { error: String(error) });
			await sleep(5_000, controller.signal);
		} finally {
			if (decodedTotal !== before) await logProgress();
		}
	}
}

const progressTimer = setInterval(() => {
	void logProgress();
}, 60_000);
progressTimer.unref();

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname !== "/health") {
			return Response.json({ error: "Not Found" }, { status: 404 });
		}

		try {
			const health = await getL2DecoderHealth();
			return Response.json(health, {
				status: health.status === "healthy" ? 200 : 503,
			});
		} catch (error) {
			return Response.json(
				{ status: "unhealthy", error: String(error) },
				{ status: 503 },
			);
		}
	},
});

logger.info("Starting L2 decoder service", { port: PORT });
void runDecoder();

async function shutdown() {
	logger.info("Shutting down L2 decoder service");
	controller.abort();
	clearInterval(progressTimer);
	server.stop();
	await closeDb();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
