// The real `BlockNotifier` (D12): subscribes to bitcoind's `hashblock` ZMQ
// topic and resolves `notified()` on every message, plus a 60s reconnect
// timer as a safety net if ZMQ has gone silent (not polling for blocks — a
// dead-man's switch on the push channel itself, per plan design).
//
// Deliberately its own file, separate from `follow.ts`: the `zeromq` npm
// package's native module calls `uv_async_init` at import time, which panics
// the whole process under Bun 1.4.2 (`bun.report/1.4.2/...`,
// https://github.com/oven-sh/bun/issues/18546) — a hard crash, not a
// catchable exception. `connect()` below loads it with a dynamic `import()`,
// never at module scope, so nothing that merely imports `ZmqNotifier` (e.g.
// `cli.ts`, or this file appearing in another module's import graph under
// `bun test`) ever triggers that crash — only actually calling `connect()`
// does. See NOTES in plan 057 for the verified repro.

import type { BlockNotifier } from "./follow.ts";

/** A `zeromq` `Subscriber`'s shape, narrowed to what this module uses — avoids a static import of the package's types (which would still be safe, since types vanish at runtime, but keeps the "never imported eagerly" property visibly true of the whole file, not just its runtime behavior). */
interface ZmqSubscriberLike {
	connect(address: string): void;
	subscribe(topic: string): void;
	close(): void;
	[Symbol.asyncIterator](): AsyncIterator<Buffer[]>;
}

export interface ZmqNotifierOptions {
	/** e.g. `tcp://37.27.171.220:28332` — bitcoind's `-zmqpubhashblock` endpoint. */
	url: string;
	/** Safety-net interval: `notified()` also resolves after this long with no ZMQ message. Default 60s (plan design). */
	reconnectMs?: number;
}

/**
 * Subscribes to `hashblock` on `options.url`. `notified()` resolves on every
 * message AND every `reconnectMs` even with no message — the reconnect timer
 * is a dead-man's switch for a silently-dropped ZMQ connection, not a polling
 * loop (it never checks the chain itself; `follow.ts`'s `syncOnce` does that
 * when woken).
 */
export class ZmqNotifier implements BlockNotifier {
	private readonly url: string;
	private readonly reconnectMs: number;
	private sock: ZmqSubscriberLike | undefined;
	private pending: Array<() => void> = [];
	private closed = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private connectPromise: Promise<void> | undefined;

	constructor(options: ZmqNotifierOptions) {
		this.url = options.url;
		this.reconnectMs = options.reconnectMs ?? 60_000;
	}

	/** Connects and starts the receive loop + reconnect timer. Call once before the first `notified()`. */
	async connect(): Promise<void> {
		if (this.connectPromise) return this.connectPromise;
		this.connectPromise = this.doConnect();
		return this.connectPromise;
	}

	private async doConnect(): Promise<void> {
		// Dynamic import: see the module docstring — this is the only line in
		// the whole file that can ever trigger the `uv_async_init` crash, and it
		// only runs when a caller actually starts following the tip.
		const { Subscriber } = await import("zeromq");
		const sock = new Subscriber() as unknown as ZmqSubscriberLike;
		sock.connect(this.url);
		sock.subscribe("hashblock");
		this.sock = sock;

		this.timer = setInterval(() => this.wake(), this.reconnectMs);

		void this.receiveLoop(sock);
	}

	private async receiveLoop(sock: ZmqSubscriberLike): Promise<void> {
		try {
			for await (const _msg of sock) {
				if (this.closed) return;
				this.wake();
			}
		} catch {
			// A closed socket rejects/ends the iterator — expected on close().
		}
	}

	private wake(): void {
		const waiters = this.pending;
		this.pending = [];
		for (const resolve of waiters) resolve();
	}

	async notified(): Promise<void> {
		return new Promise((resolve) => {
			this.pending.push(resolve);
		});
	}

	close(): void {
		this.closed = true;
		if (this.timer) clearInterval(this.timer);
		this.sock?.close();
		this.wake();
	}
}
