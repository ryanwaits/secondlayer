import { logger } from "@secondlayer/shared/logger";
import { listen } from "@secondlayer/shared/queue/listener";
import { TxTimeoutError } from "@secondlayer/stacks";

/**
 * Waits for Stacks transactions to confirm on-chain via pg_notify on the
 * core `transactions` table.
 *
 * Flow:
 *   1. Runner starts a single process-scoped listener on `tx:confirmed`
 *   2. `broadcast({ awaitConfirmation: true })` calls `awaitTxConfirmed(txId, ms)`
 *   3. Listener's map resolves the matching promise when the txid lands
 *   4. Timeout fires `TxTimeoutError` (retryable with fee bump in queue.ts)
 *
 * No Hiro fallback — Secondlayer's native indexer is the source of truth.
 * Workflows that need confirmation on a chain without active indexing get
 * the timeout path, which is correct (don't silently claim confirmation
 * from an external provider the customer didn't opt into).
 */

interface PendingWait {
	resolve: () => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingWait>();
let stopListener: (() => Promise<void>) | null = null;
let listenerPromise: Promise<void> | null = null;

async function ensureListener(): Promise<void> {
	if (listenerPromise) return listenerPromise;
	listenerPromise = (async () => {
		try {
			stopListener = await listen("tx:confirmed", (payload) => {
				if (!payload) return;
				const waiter = pending.get(payload);
				if (!waiter) return;
				clearTimeout(waiter.timer);
				pending.delete(payload);
				waiter.resolve();
			});
			logger.info("confirmation: listening on tx:confirmed");
		} catch (err) {
			logger.error("confirmation: listener startup failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			listenerPromise = null;
			throw err;
		}
	})();
	return listenerPromise;
}

/**
 * Wait for `txId` to appear in the `transactions` table or time out after
 * `timeoutMs`. Lazy-starts the pg_notify listener on first call.
 *
 * Multi-waiter safe: if two runs await the same txid concurrently (unusual
 * but possible on retry), only the first waiter wins. The caller caught by
 * `pending.set(..., second)` overwrites the first — acceptable because the
 * first run will see its timer fire then consult the DB and notice the tx
 * is already confirmed on recovery.
 *
 * Normalises `txId` to lowercase with a `0x` prefix stripped.
 */
export async function awaitTxConfirmed(
	txId: string,
	timeoutMs: number,
): Promise<void> {
	await ensureListener();
	const normalized = normalizeTxId(txId);

	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(normalized);
			reject(
				new TxTimeoutError(
					`tx ${normalized} not confirmed within ${timeoutMs}ms`,
					normalized,
					timeoutMs,
				),
			);
		}, timeoutMs);
		pending.set(normalized, { resolve, reject, timer });
	});
}

function normalizeTxId(id: string): string {
	const lower = id.toLowerCase();
	return lower.startsWith("0x") ? lower.slice(2) : lower;
}

/** Stop the listener. Called at runner shutdown. */
export async function stopConfirmationListener(): Promise<void> {
	for (const [, w] of pending) {
		clearTimeout(w.timer);
		w.reject(new Error("runner shutdown"));
	}
	pending.clear();
	if (stopListener) {
		await stopListener();
		stopListener = null;
	}
	listenerPromise = null;
}
