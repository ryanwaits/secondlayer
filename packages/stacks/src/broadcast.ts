import { AsyncLocalStorage } from "node:async_hooks";
import type { TxIntent } from "./tx/builders.ts";

/**
 * Submit a transaction intent to the Stacks network via a workflow-declared
 * signer. The Secondlayer runner intercepts this call to:
 *
 *   1. Resolve `signer` to a `RemoteSignerConfig` (endpoint + publicKey +
 *      hmacRef) declared on the workflow.
 *   2. Fetch the HMAC secret from the runtime secret store.
 *   3. Enforce safety caps (`maxMicroStx`, `maxFee`).
 *   4. POST the unsigned tx breakdown to the customer's signer endpoint.
 *   5. Submit the returned signed tx to the Stacks node.
 *
 * Returns the txId immediately. Confirmation polling lands in Sprint 5 via
 * `awaitConfirmation: true` (no-op today — subgraph-backed path forthcoming).
 *
 * Throws `TxRejectedError`, `TxTimeoutError`, or `TxSignerRefusedError` from
 * `@secondlayer/stacks/errors` on failure.
 *
 * Must be called inside a workflow handler (directly or inside `step.run`).
 * Calls outside a runtime-bound context throw immediately.
 */
export interface BroadcastOptions {
	/** Name of a signer declared in `WorkflowDefinition.signers`. */
	signer: string;
	/**
	 * If `true`, wait for the tx to be confirmed on-chain before returning.
	 * Sprint 4 ships this flag as a no-op — Sprint 5 adds subgraph-backed
	 * confirmation polling.
	 */
	awaitConfirmation?: boolean;
	/** Minimum confirmations before returning. Only meaningful when `awaitConfirmation: true`. */
	minConfirmations?: number;
	/**
	 * Hard cap on micro-STX that can be spent. Required when the tx amount is
	 * derived from an AI step (the deploy-time AST check enforces this).
	 */
	maxMicroStx?: bigint;
	/** Hard cap on fee in micro-STX. */
	maxFee?: bigint;
}

export interface BroadcastResult {
	txId: string;
	/** `false` for Sprint 4; `true` once `awaitConfirmation` lands in Sprint 5. */
	confirmed: boolean;
}

/**
 * Runtime contract implemented by `@secondlayer/workflow-runner`. The stacks
 * package is a pure library — it holds no keys, no DB, and no network —
 * so actual broadcasting is delegated to whatever runtime bound the context.
 */
export interface BroadcastRuntime {
	broadcast(intent: TxIntent, opts: BroadcastOptions): Promise<BroadcastResult>;
}

/**
 * Per-run `AsyncLocalStorage` binding. The runner calls
 * `broadcastContext.run(runtime, async () => handler(ctx))` so concurrent
 * workflow runs see isolated runtime bindings — no module-level global state
 * is mutated.
 */
export const broadcastContext: AsyncLocalStorage<BroadcastRuntime> =
	new AsyncLocalStorage<BroadcastRuntime>();

export async function broadcast(
	intent: TxIntent,
	opts: BroadcastOptions,
): Promise<BroadcastResult> {
	const runtime = broadcastContext.getStore();
	if (!runtime) {
		throw new Error(
			"broadcast() called outside a workflow runner context. " +
				"Only call `broadcast` inside a workflow handler (directly or inside `step.run`).",
		);
	}
	if (opts.maxMicroStx != null && opts.maxMicroStx <= 0n) {
		throw new Error("maxMicroStx must be positive when set");
	}
	if (opts.maxFee != null && opts.maxFee <= 0n) {
		throw new Error("maxFee must be positive when set");
	}
	return runtime.broadcast(intent, opts);
}
