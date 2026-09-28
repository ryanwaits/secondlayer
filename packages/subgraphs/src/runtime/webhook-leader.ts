import {
	type LeaderBackend,
	WEBHOOK_EVALUATOR_LOCK_KEY,
	createPostgresLeaderBackend,
	withLeaderLock,
} from "@secondlayer/shared/leader";
import { targetListenerUrl } from "@secondlayer/shared/queue/listener";
import { startBitcoinTriggerEvaluator } from "./bitcoin-trigger-evaluator.ts";
import { startTriggerEvaluator } from "./trigger-evaluator-loop.ts";

/**
 * Leader-gating for the chain-webhook real-time plane.
 *
 * The evaluator runs unconditionally per replica against one global cursor, so
 * N replicas mean N× redundant Index fetch+match every tick (correct via
 * `dedup_key`, but wasteful and a de-facto one-replica cap). Electing a single
 * leader lets the plane scale out while exactly one process drives the cursor.
 *
 * The lock lives on the target DB — `trigger_evaluator_state` and
 * `webhook_outbox` are control-plane state, which the source/target split
 * homes on the target. A lock on the default source DB would guard nothing.
 */

let evaluatorLeader = false;

/**
 * True only on the process currently holding the evaluator lock. The chain-reorg
 * handler gates on this so its `trigger_evaluator_state` cursor rewind never
 * races the evaluator's forward advance on another replica — they mutate the
 * same row, so they must run on the same single leader.
 */
export function isEvaluatorLeader(): boolean {
	return evaluatorLeader;
}

/**
 * Wrap the chain-reorg handler so it fires only while this process is the
 * evaluator leader. The handler rewinds `trigger_evaluator_state` — the same row
 * the evaluator advances — so running it on a non-leader would race the leader's
 * cursor. The subgraph-reorg handler is left ungated (idempotent row-deletes).
 */
export function gateChainReorgOnLeader(
	handler: (forkHeight: number) => Promise<void>,
	isLeader: () => boolean = isEvaluatorLeader,
): (forkHeight: number) => Promise<void> {
	return async (forkHeight) => {
		if (!isLeader()) return;
		await handler(forkHeight);
	};
}

export type StartTriggerEvaluatorLeaderOptions = {
	pollMs?: number;
	heartbeatMs?: number;
	/** Injectable for tests; defaults to the real Postgres backend on target. */
	createBackend?: () => LeaderBackend;
	/** Injectable for tests; defaults to starting both evaluator loops
	 *  (Stacks + Bitcoin, see `startDefaultEvaluators` below). */
	startWork?: () => (() => void) | Promise<() => void>;
};

/**
 * Start both chain-trigger evaluator loops (Stacks + Bitcoin/Runes, plan 060)
 * under one leader election — they share the same `trigger_evaluator_state`
 * row (one column per chain), so the same leader must drive both. Returns a
 * stop function that stops each loop.
 */
function startDefaultEvaluators(): () => void {
	const stopStacks = startTriggerEvaluator();
	const stopBitcoin = startBitcoinTriggerEvaluator();
	return () => {
		stopStacks();
		stopBitcoin();
	};
}

/**
 * Run the chain-trigger evaluator only while this process is the elected leader.
 * Returns a stop function that ends election, stops the loop, and releases the
 * lock.
 */
export function startTriggerEvaluatorLeader(
	opts: StartTriggerEvaluatorLeaderOptions = {},
): () => Promise<void> {
	const startWork = opts.startWork ?? startDefaultEvaluators;
	return withLeaderLock(
		WEBHOOK_EVALUATOR_LOCK_KEY,
		async () => {
			evaluatorLeader = true;
			const stop = await startWork();
			return () => {
				evaluatorLeader = false;
				stop();
			};
		},
		{
			pollMs: opts.pollMs,
			heartbeatMs: opts.heartbeatMs,
			createBackend:
				opts.createBackend ??
				(() => createPostgresLeaderBackend(targetListenerUrl())),
		},
	);
}
