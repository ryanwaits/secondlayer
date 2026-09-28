// The real `BlockNotifier` (D12, amended 2026-09-26): wakes on bitcoind's own
// blocking `waitfornewblock(timeoutMs)` RPC instead of ZMQ. `zeromq@6.8.0`
// crashes Bun 1.4.2 at import (oven-sh/bun#18546) — `waitfornewblock` runs
// over the existing authenticated RPC, works under Bun, and works for
// self-hosters on remote/hosted nodes that don't expose ZMQ.
//
// `waitfornewblock` is a *hidden* RPC in Bitcoin Core 29.4 (verified
// 2026-09-26: `bitcoin-cli help waitfornewblock` works, but it isn't listed
// in `help`) — undocumented, not deprecated. If a future Core release drops
// it, a node answers `-32601` (method not found) and `notified()` switches
// permanently to polling `getbestblockhash` every `pollMs` instead.

import type { BlockNotifier } from "./follow.ts";
import { type BitcoinRpcClient, BitcoinRpcError } from "./rpc.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 5_000;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** Resolves after `ms`, or immediately if/when `signal` aborts — races `close()` against the fallback's poll/backoff delays so it doesn't wait out a full `pollMs`/backoff on stop (plan 084). */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		function onAbort() {
			clearTimeout(timer);
			resolve();
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export interface RpcWaitNotifierOptions {
	rpc: Pick<BitcoinRpcClient, "waitfornewblock" | "getbestblockhash">;
	/** Defaults to `BITCOIN_WAIT_TIMEOUT_MS` env, or 30000. */
	timeoutMs?: number;
	/** Fallback poll interval once `-32601` is seen. Defaults to `BITCOIN_POLL_MS` env, or 5000. */
	pollMs?: number;
	/** Test seam: overrides the real `setTimeout`-based sleep used for backoff and fallback polling. Receives `close()`'s abort signal so a test can assert it's wired through. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * `notified()` calls `waitfornewblock(timeoutMs)` and resolves whether that
 * returns because a block landed or because the timeout elapsed — either way
 * it's just a signal to re-run `syncOnce`. It never rejects: on a network or
 * RPC error it waits an exponentially growing backoff (capped at 30s), then
 * resolves, so `syncOnce` itself is what surfaces a real RPC failure. On
 * `BitcoinRpcError` code `-32601` it switches permanently to polling
 * `getbestblockhash` and logs the switch once. `close()` aborts an
 * `AbortController` shared with any in-flight `waitfornewblock` call and the
 * fallback's poll/backoff sleeps, so a wait already in progress resolves
 * immediately instead of running out its full timeout/delay (plan 084).
 */
export class RpcWaitNotifier implements BlockNotifier {
	private readonly rpc: RpcWaitNotifierOptions["rpc"];
	private readonly timeoutMs: number;
	private readonly pollMs: number;
	private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
	private readonly abortController = new AbortController();

	private closed = false;
	private useFallback = false;
	private fallbackLogged = false;
	private backoffMs = BASE_BACKOFF_MS;
	private lastBestHash: string | undefined;

	constructor(options: RpcWaitNotifierOptions) {
		this.rpc = options.rpc;
		this.timeoutMs =
			options.timeoutMs ??
			Number(process.env.BITCOIN_WAIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
		this.pollMs =
			options.pollMs ?? Number(process.env.BITCOIN_POLL_MS ?? DEFAULT_POLL_MS);
		this.sleepFn = options.sleep ?? sleep;
	}

	async notified(): Promise<void> {
		if (this.closed) return;
		if (this.useFallback) return this.notifiedFallback();

		try {
			await this.rpc.waitfornewblock(
				this.timeoutMs,
				this.abortController.signal,
			);
			this.resetBackoff();
		} catch (error) {
			// close() aborted a call already in flight — resolve silently, no
			// backoff or log line (it's a deliberate stop, not a failure).
			if (this.closed) return;
			if (error instanceof BitcoinRpcError && error.code === -32601) {
				this.useFallback = true;
				if (!this.fallbackLogged) {
					this.fallbackLogged = true;
					console.error(
						"RpcWaitNotifier: waitfornewblock not supported (-32601) — falling back to getbestblockhash polling",
					);
				}
				return this.notifiedFallback();
			}
			await this.sleepFn(this.nextBackoff(), this.abortController.signal);
		}
	}

	private async notifiedFallback(): Promise<void> {
		if (this.closed) return;

		if (this.lastBestHash === undefined) {
			try {
				this.lastBestHash = await this.rpc.getbestblockhash();
			} catch {
				if (this.closed) return;
				await this.sleepFn(this.nextBackoff(), this.abortController.signal);
				return;
			}
		}

		for (;;) {
			if (this.closed) return;
			await this.sleepFn(this.pollMs, this.abortController.signal);
			if (this.closed) return;

			let hash: string;
			try {
				hash = await this.rpc.getbestblockhash();
			} catch {
				if (this.closed) return;
				await this.sleepFn(this.nextBackoff(), this.abortController.signal);
				return;
			}
			if (hash !== this.lastBestHash) {
				this.lastBestHash = hash;
				this.resetBackoff();
				return;
			}
		}
	}

	private nextBackoff(): number {
		const wait = this.backoffMs;
		this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
		return wait;
	}

	private resetBackoff(): void {
		this.backoffMs = BASE_BACKOFF_MS;
	}

	close(): void {
		this.closed = true;
		this.abortController.abort();
	}
}
