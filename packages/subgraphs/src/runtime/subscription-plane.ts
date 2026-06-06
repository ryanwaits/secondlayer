import { logger } from "@secondlayer/shared/logger";
import { handleChainReorg } from "./chain-reorg.ts";
import { startEmitter } from "./emitter.ts";
import { startStreamsReorgPoll } from "./streams-reorg-poll.ts";
import {
	gateChainReorgOnLeader,
	startTriggerEvaluatorLeader,
} from "./subscription-leader.ts";

/**
 * The real-time subscription delivery plane: the chain-trigger evaluator
 * (leader-gated), the shared-outbox emitter (competing-consumer, horizontally
 * safe), and the chain-reorg cursor rewind (gated on the evaluator leader, since
 * it rewinds the same `trigger_evaluator_state` row the evaluator advances).
 *
 * Extracted so it can run in its own `subscription-processor` service, isolated
 * from subgraph indexing (a crash-looping or CPU-hot subgraph no longer stalls
 * webhook delivery). For now `startSubgraphProcessor` also boots it — the
 * two-deploy cutover removes that call once the dedicated service is verified.
 */
export async function startSubscriptionPlane(): Promise<() => Promise<void>> {
	const streamsIndex = process.env.SUBGRAPH_SOURCE === "streams-index";

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
	// subscriptions; FOR UPDATE SKIP LOCKED makes it safe across replicas.
	const stopEmitter = await startEmitter();

	logger.info("Subscription plane ready", { streamsIndex });

	return async () => {
		stopChainReorgPoll?.();
		await stopTriggerEvaluator?.();
		await stopEmitter();
	};
}
