import { getTargetDb } from "@secondlayer/shared/db";
import { listActiveChainWebhooks } from "@secondlayer/shared/db/queries/webhooks";
import { logger } from "@secondlayer/shared/logger";
import { isTestnetWebhookStack } from "@secondlayer/shared/mode";
import { hasActiveRuneWebhooks } from "./bitcoin-trigger-evaluator.ts";
import { handleChainReorg, reorgScope } from "./chain-reorg.ts";
import { startEmitter } from "./emitter.ts";
import { startInsightsLoop } from "./insights-loop.ts";
import { startMeterSocketReporter } from "./meter-socket.ts";
import { startStreamsReorgPoll } from "./streams-reorg-poll.ts";
import {
	gateChainReorgOnLeader,
	startTriggerEvaluatorLeader,
} from "./webhook-leader.ts";

/** Subsystems `startWebhookPlane` boots; every one defaults to the production implementation. */
export interface WebhookPlaneDeps {
	listActiveChainWebhooks: () => Promise<unknown[]>;
	startStreamsReorgPoll: typeof startStreamsReorgPoll;
	gateChainReorgOnLeader: typeof gateChainReorgOnLeader;
	handleChainReorg: typeof handleChainReorg;
	hasActiveRuneWebhooks: () => Promise<boolean>;
	startTriggerEvaluatorLeader: () => () => Promise<void>;
	startEmitter: () => Promise<() => Promise<void>>;
	startMeterSocketReporter: typeof startMeterSocketReporter;
	isTestnetWebhookStack: typeof isTestnetWebhookStack;
	startInsightsLoop: () => () => Promise<void>;
}

const defaultWebhookPlaneDeps: WebhookPlaneDeps = {
	listActiveChainWebhooks: () => listActiveChainWebhooks(getTargetDb()),
	startStreamsReorgPoll,
	gateChainReorgOnLeader,
	handleChainReorg,
	hasActiveRuneWebhooks: () => hasActiveRuneWebhooks(),
	startTriggerEvaluatorLeader: () => startTriggerEvaluatorLeader(),
	startEmitter: () => startEmitter(),
	startMeterSocketReporter,
	isTestnetWebhookStack,
	startInsightsLoop: () => startInsightsLoop(),
};

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
export async function startWebhookPlane(
	deps: Partial<WebhookPlaneDeps> = {},
): Promise<() => Promise<void>> {
	const d: WebhookPlaneDeps = { ...defaultWebhookPlaneDeps, ...deps };
	const streamsIndex = process.env.SUBGRAPH_SOURCE === "streams-index";

	// The chain-trigger evaluator only runs under streams-index (below). A
	// `kind="chain"` webhook on any other instance is silently dead — no
	// error, it just never fires — so warn loudly once at boot instead of
	// leaving the operator to notice deliveries never showing up. Mirrored
	// per-webhook in the API's `toDetail` (create/get responses) and in
	// `secondlayer webhooks doctor`.
	if (!streamsIndex) {
		const activeChainWebhooks = await d.listActiveChainWebhooks();
		if (activeChainWebhooks.length > 0) {
			logger.warn(
				"Chain webhooks exist but this instance's chain-trigger evaluator is not running — they will never fire. Set SUBGRAPH_SOURCE=streams-index to enable it.",
				{ chainWebhookCount: activeChainWebhooks.length },
			);
		}
	}

	// Chain-reorg rewind off the public Streams reorg feed (the streams-index path
	// has no Postgres NOTIFY). Gated on the evaluator leader so the rewind and the
	// evaluator's advance never race the same cursor across replicas. Bitcoin
	// (Runes, plan 060) runs its OWN poll — a separate feed, own cursor — but
	// under the same leader gate, since both rewind columns on the one
	// `trigger_evaluator_state` row the two evaluators advance.
	const stopChainReorgPoll = streamsIndex
		? d.startStreamsReorgPoll(
				d.gateChainReorgOnLeader((forkHeight, reorg) =>
					d.handleChainReorg(
						forkHeight,
						undefined,
						"stacks",
						reorgScope(reorg),
					),
				),
			)
		: undefined;
	const stopBitcoinReorgPoll = streamsIndex
		? d.startStreamsReorgPoll(
				d.gateChainReorgOnLeader((forkHeight, reorg) =>
					d.handleChainReorg(
						forkHeight,
						undefined,
						"bitcoin",
						reorgScope(reorg),
					),
				),
				"bitcoin",
				() => d.hasActiveRuneWebhooks(),
			)
		: undefined;

	const stopTriggerEvaluator = streamsIndex
		? d.startTriggerEvaluatorLeader()
		: undefined;

	const stopEmitter = await d.startEmitter();

	const stopMeterSocket = d.startMeterSocketReporter();

	// Dashboard insights: webhook and subgraph rules, evaluated every minute
	// on the elected leader. Runs on self-host too. Not on the shared testnet
	// stack: no customer can read insights there.
	const stopInsights = d.isTestnetWebhookStack()
		? undefined
		: d.startInsightsLoop();

	logger.info("Webhook plane ready", { streamsIndex });

	return async () => {
		stopChainReorgPoll?.();
		stopBitcoinReorgPoll?.();
		await stopTriggerEvaluator?.();
		await stopEmitter();
		stopMeterSocket();
		await stopInsights?.();
	};
}
