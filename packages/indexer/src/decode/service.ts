import {
	isPox4DecoderEnabled,
	isPox5DecoderEnabled,
} from "@secondlayer/shared";
import { assertDbSplit, closeDb } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import {
	consumeFtBurnDecodedEvents,
	consumeFtMintDecodedEvents,
	consumeFtTransferDecodedEvents,
	consumeNftBurnDecodedEvents,
	consumeNftMintDecodedEvents,
	consumeNftTransferDecodedEvents,
	consumePrintDecodedEvents,
	consumeStxBurnDecodedEvents,
	consumeStxLockDecodedEvents,
	consumeStxMintDecodedEvents,
	consumeStxTransferDecodedEvents,
} from "./decoder.ts";
import { consumeBnsDecodedEvents } from "./decoders/bns.ts";
import { consumePox4DecodedEvents } from "./decoders/pox-4.ts";
import { consumePox5DecodedEvents } from "./decoders/pox-5.ts";
import {
	consumeSbtcRegistryDecodedEvents,
	consumeSbtcTokenDecodedEvents,
} from "./decoders/sbtc.ts";
import { getDecodersHealth } from "./health.ts";
import {
	SETTLEMENT_CONFIRMER_NAME,
	consumeSbtcSettlements,
	getSettlementConfirmerHealth,
} from "./settlement.ts";
import { bumpDecoderCheckpoint } from "./storage.ts";

const PORT = Number.parseInt(process.env.PORT || "3710", 10);
const controller = new AbortController();
// sbtc defaults to enabled — the sBTC decoder fills the decoded_events table;
// opt out with `SBTC_DECODER_ENABLED=false`.
const SBTC_ENABLED = process.env.SBTC_DECODER_ENABLED !== "false";
const POX4_ENABLED = isPox4DecoderEnabled();
const POX5_ENABLED = isPox5DecoderEnabled();
const BNS_ENABLED = process.env.BNS_DECODER_ENABLED === "true";
// Opt-in (needs bitcoind RPC creds): the BTC L1 settlement confirmer for sBTC
// withdrawals. Kept OUT of getEnabledDecoderNames/floor-audit — it has its own
// health path (see settlement.ts).
const SETTLEMENT_CONFIRMER_ENABLED =
	process.env.SBTC_SETTLEMENT_CONFIRMER_ENABLED === "true";
const DECODED_EVENT_DECODERS = {
	"decode.ft_transfer.v1": 0,
	"decode.nft_transfer.v1": 0,
	"decode.stx_transfer.v1": 0,
	"decode.stx_mint.v1": 0,
	"decode.stx_burn.v1": 0,
	"decode.stx_lock.v1": 0,
	"decode.ft_mint.v1": 0,
	"decode.ft_burn.v1": 0,
	"decode.nft_mint.v1": 0,
	"decode.nft_burn.v1": 0,
	"decode.print.v1": 0,
} as const;
const decodedTotals: Record<string, number> = {
	...DECODED_EVENT_DECODERS,
	...(SBTC_ENABLED ? { "decode.sbtc.v1": 0, "decode.sbtc_token.v1": 0 } : {}),
	...(POX4_ENABLED ? { "decode.pox4.v1": 0 } : {}),
	...(POX5_ENABLED ? { "decode.pox5.v1": 0 } : {}),
	...(BNS_ENABLED ? { "decode.bns.v1": 0 } : {}),
	...(SETTLEMENT_CONFIRMER_ENABLED ? { [SETTLEMENT_CONFIRMER_NAME]: 0 } : {}),
};
const decodedThisMinute: Record<string, number> = {
	...DECODED_EVENT_DECODERS,
	...(SBTC_ENABLED ? { "decode.sbtc.v1": 0, "decode.sbtc_token.v1": 0 } : {}),
	...(POX4_ENABLED ? { "decode.pox4.v1": 0 } : {}),
	...(POX5_ENABLED ? { "decode.pox5.v1": 0 } : {}),
	...(BNS_ENABLED ? { "decode.bns.v1": 0 } : {}),
	...(SETTLEMENT_CONFIRMER_ENABLED ? { [SETTLEMENT_CONFIRMER_NAME]: 0 } : {}),
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

// getDecodersHealth covers the enabled-decoder set; the settlement confirmer is
// deliberately excluded from that set (it has no genesis floor — keeps it off
// floor-audit), so append its dedicated health here when enabled.
async function getServiceHealth(): Promise<
	Awaited<ReturnType<typeof getDecodersHealth>>
> {
	const health = await getDecodersHealth();
	if (!SETTLEMENT_CONFIRMER_ENABLED) return health;
	const confirmer = await getSettlementConfirmerHealth();
	const decoders = [...health.decoders, confirmer];
	return {
		status: decoders.every((decoder) => decoder.status === "healthy")
			? "healthy"
			: "unhealthy",
		decoders,
	};
}

async function logProgress(): Promise<void> {
	try {
		const health = await getServiceHealth();
		logger.info("decoder.progress", {
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
		logger.warn("decoder.progress_failed", { error: String(error) });
	}
}

type DecoderConsumeFn = (opts: {
	batchSize?: number;
	emptyBackoffMs?: number;
	maxEmptyPolls?: number;
	signal?: AbortSignal;
	onProgress?: (stats: {
		decoded: number;
		cursor?: string | null;
		lagSeconds?: number;
	}) => void | Promise<void>;
}) => Promise<{ cursor: string | null; pages: number; decoded: number }>;

async function runDecoder(
	decoderName: string,
	consume: DecoderConsumeFn,
): Promise<void> {
	while (!controller.signal.aborted) {
		const before = decodedTotals[decoderName] ?? 0;
		try {
			await consume({
				batchSize: Number.parseInt(process.env.DECODER_BATCH_SIZE ?? "500", 10),
				emptyBackoffMs: Number.parseInt(
					process.env.DECODER_EMPTY_BACKOFF_MS ?? "1000",
					10,
				),
				// Force `consume()` to return after a small empty-poll budget
				// so `runDecoder`'s `finally` block runs the liveness ping and
				// progress log. Without this, a stream that returns no events
				// (e.g. sparse contract filter at-tip) keeps the SDK consumer
				// looping forever and `updated_at` goes stale.
				maxEmptyPolls: Number.parseInt(
					process.env.DECODER_MAX_EMPTY_POLLS ?? "1",
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
			logger.error("decoder.error", {
				decoder: decoderName,
				error: String(error),
			});
			await sleep(5_000, controller.signal);
		} finally {
			// Liveness ping: bump checkpoint updated_at every iteration so the
			// health endpoint can tell "process alive, no new events" apart
			// from "process stuck or crashed." Keeps deploys from bailing when
			// a decoder finishes its work and quietly polls at-tip.
			try {
				await bumpDecoderCheckpoint({ decoderName });
			} catch {
				// Best-effort; if the DB is down the health endpoint already
				// reports the larger problem.
			}
			if ((decodedTotals[decoderName] ?? 0) !== before) await logProgress();
		}
	}
}

async function runDecoders(): Promise<void> {
	const tasks = [
		runDecoder("decode.ft_transfer.v1", consumeFtTransferDecodedEvents),
		runDecoder("decode.nft_transfer.v1", consumeNftTransferDecodedEvents),
		runDecoder("decode.stx_transfer.v1", consumeStxTransferDecodedEvents),
		runDecoder("decode.stx_mint.v1", consumeStxMintDecodedEvents),
		runDecoder("decode.stx_burn.v1", consumeStxBurnDecodedEvents),
		runDecoder("decode.stx_lock.v1", consumeStxLockDecodedEvents),
		runDecoder("decode.ft_mint.v1", consumeFtMintDecodedEvents),
		runDecoder("decode.ft_burn.v1", consumeFtBurnDecodedEvents),
		runDecoder("decode.nft_mint.v1", consumeNftMintDecodedEvents),
		runDecoder("decode.nft_burn.v1", consumeNftBurnDecodedEvents),
		runDecoder("decode.print.v1", consumePrintDecodedEvents),
	];
	if (SBTC_ENABLED) {
		tasks.push(runDecoder("decode.sbtc.v1", consumeSbtcRegistryDecodedEvents));
		tasks.push(
			runDecoder("decode.sbtc_token.v1", consumeSbtcTokenDecodedEvents),
		);
	} else {
		logger.info("decoder.sbtc_disabled");
	}
	if (POX4_ENABLED) {
		tasks.push(runDecoder("decode.pox4.v1", consumePox4DecodedEvents));
	} else {
		logger.info("decoder.pox4_disabled");
	}
	if (POX5_ENABLED) {
		tasks.push(runDecoder("decode.pox5.v1", consumePox5DecodedEvents));
	} else {
		logger.info("decoder.pox5_disabled");
	}
	if (BNS_ENABLED) {
		tasks.push(runDecoder("decode.bns.v1", consumeBnsDecodedEvents));
	} else {
		logger.info("decoder.bns_disabled");
	}
	if (SETTLEMENT_CONFIRMER_ENABLED) {
		tasks.push(runDecoder(SETTLEMENT_CONFIRMER_NAME, consumeSbtcSettlements));
	} else {
		logger.info("settlement_confirmer_disabled");
	}
	await Promise.all(tasks);
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
			const health = await getServiceHealth();
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

assertDbSplit();
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
