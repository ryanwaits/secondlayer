import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import { handleChainReorg } from "./chain-reorg.ts";
import { startEmitter } from "./emitter.ts";
import { startMeterSocketReporter } from "./meter-socket.ts";
import { startStreamsReorgPoll } from "./streams-reorg-poll.ts";
import {
	gateChainReorgOnLeader,
	startTriggerEvaluatorLeader,
} from "./webhook-leader.ts";

/**
 * The real-time webhook delivery plane: the chain-trigger evaluator
 * (leader-gated), the shared-outbox emitter (competing-consumer, horizontally
 * safe), and the chain-reorg cursor rewind (gated on the evaluator leader, since
 * it rewinds the same `trigger_evaluator_state` row the evaluator advances).
 *
 * Extracted so it can run in its own `webhook-processor` service, isolated
 * from subgraph indexing (a crash-looping or CPU-hot subgraph no longer stalls
 * webhook delivery). The two-deploy cutover is complete: `webhook-service.ts`
 * is the sole booter; `startSubgraphProcessor` no longer boots the plane.
 */
export async function startWebhookPlane(): Promise<() => Promise<void>> {
	const streamsIndex = process.env.SUBGRAPH_SOURCE === "streams-index";

	// The chain-trigger evaluator only runs under streams-index (below). A
	// `kind="chain"` webhook on any other instance is silently dead — no
	// error, it just never fires — so warn loudly once at boot instead of
	// leaving the operator to notice deliveries never showing up. Mirrored
	// per-webhook in the API's `toDetail` (create/get responses) and in
	// `secondlayer webhooks doctor`.
	if (!streamsIndex) {
		const activeChainWebhooks = await listActiveChainWebhooks(getTargetDb());
		if (activeChainWebhooks.length > 0) {
			logger.warn(
				"Chain webhooks exist but this instance's chain-trigger evaluator is not running — they will never fire. Set SUBGRAPH_SOURCE=streams-index to enable it.",
				{ chainWebhookCount: activeChainWebhooks.length },
			);
		}
	}

	// Chain-reorg rewind off the public Streams reorg feed (the streams-index path
	// has no Postgres NOTIFY). Gated on the evaluator leader so the rewind and the
	// evaluator's advance never race the same cursor across replicas.
	const stopChainReorgPoll = streamsIndex
		? startStreamsReorgPoll(
				gateChainReorgOnLeader((forkHeight) => handleChainReorg(forkHeight)),
			)
		: undefined;

	const stopTriggerEvaluator = streamsIndex
		? startTriggerEvaluatorLeader()
		: undefined;

	// The emitter drains the shared outbox for BOTH subgraph and chain
	// webhooks; FOR UPDATE SKIP LOCKED makes it safe across replicas.
	const stopEmitter = await startEmitter();

	// Hosted-stack event meter (plan 044, step 5): a no-op unless
	// WEBHOOK_METER_SOCKET is set (self-host never sets it).
	const stopMeterSocket = startMeterSocketReporter();

	logger.info("Webhook plane ready", { streamsIndex });

	return async () => {
		stopChainReorgPoll?.();
		await stopTriggerEvaluator?.();
		await stopEmitter();
		stopMeterSocket();
	};
}
