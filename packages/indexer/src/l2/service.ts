import { closeDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import {
	consumeFtTransferDecodedEvents,
	consumeNftTransferDecodedEvents,
} from "./decoder.ts";
import { getL2DecodersHealth } from "./health.ts";

const PORT = Number.parseInt(process.env.PORT || "3710", 10);
const controller = new AbortController();
const decodedTotals: Record<string, number> = {
	"l2.ft_transfer.v1": 0,
	"l2.nft_transfer.v1": 0,
};
const decodedThisMinute: Record<string, number> = {
	"l2.ft_transfer.v1": 0,
	"l2.nft_transfer.v1": 0,
};

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
		const health = await getL2DecodersHealth();
		logger.info("l2_decoder.progress", {
			status: health.status,
			decoders: health.decoders.map((decoder) => ({
				decoder: decoder.decoder,
				writes_per_minute: decodedThisMinute[decoder.decoder] ?? 0,
				decoded_total: decodedTotals[decoder.decoder] ?? 0,
				lag_seconds: decoder.lag_seconds,
				checkpoint: decoder.checkpoint,
				status: decoder.status,
			})),
		});
		for (const decoder of Object.keys(decodedThisMinute)) {
			decodedThisMinute[decoder] = 0;
		}
	} catch (error) {
		logger.warn("l2_decoder.progress_failed", { error: String(error) });
	}
}

async function runDecoder(
	decoderName: string,
	consume: typeof consumeFtTransferDecodedEvents,
): Promise<void> {
	while (!controller.signal.aborted) {
		const before = decodedTotals[decoderName] ?? 0;
		try {
			await consume({
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
					decodedTotals[decoderName] =
						(decodedTotals[decoderName] ?? 0) + decoded;
					decodedThisMinute[decoderName] =
						(decodedThisMinute[decoderName] ?? 0) + decoded;
				},
			});
		} catch (error) {
			if (controller.signal.aborted) return;
			logger.error("l2_decoder.error", {
				decoder: decoderName,
				error: String(error),
			});
			await sleep(5_000, controller.signal);
		} finally {
			if ((decodedTotals[decoderName] ?? 0) !== before) await logProgress();
		}
	}
}

async function runDecoders(): Promise<void> {
	await Promise.all([
		runDecoder("l2.ft_transfer.v1", consumeFtTransferDecodedEvents),
		runDecoder("l2.nft_transfer.v1", consumeNftTransferDecodedEvents),
	]);
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
			const health = await getL2DecodersHealth();
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
void runDecoders();

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
