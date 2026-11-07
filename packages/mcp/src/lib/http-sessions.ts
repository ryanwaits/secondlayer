/** Idle time after which an HTTP MCP session is closed. */
export const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

/** How often the sweep looks for idle sessions. */
export const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

interface Closable {
	close(): Promise<void>;
}

interface Entry<T extends Closable> {
	transport: T;
	lastSeen: number;
}

/**
 * HTTP MCP sessions with an idle TTL. A client that vanishes without a
 * DELETE would otherwise hold its transport (and server) forever. `get`
 * counts as activity; `sweep` closes whatever has been quiet past the TTL.
 */
export class SessionRegistry<T extends Closable> {
	private readonly entries = new Map<string, Entry<T>>();

	constructor(
		private readonly ttlMs: number = SESSION_IDLE_TTL_MS,
		private readonly now: () => number = Date.now,
	) {}

	add(id: string, transport: T): void {
		this.entries.set(id, { transport, lastSeen: this.now() });
	}

	/** The live session, marked active; `undefined` when unknown or evicted. */
	get(id: string | undefined): T | undefined {
		if (!id) return undefined;
		const entry = this.entries.get(id);
		if (!entry) return undefined;
		entry.lastSeen = this.now();
		return entry.transport;
	}

	delete(id: string): void {
		this.entries.delete(id);
	}

	get size(): number {
		return this.entries.size;
	}

	/** Close and drop every session idle longer than the TTL; returns their ids. */
	async sweep(): Promise<string[]> {
		const cutoff = this.now() - this.ttlMs;
		const expired = [...this.entries].filter(
			([, entry]) => entry.lastSeen <= cutoff,
		);
		for (const [id] of expired) this.entries.delete(id);
		await Promise.allSettled(
			expired.map(([, entry]) => entry.transport.close()),
		);
		return expired.map(([id]) => id);
	}

	/** Sweep on an interval; the timer does not keep the process alive. */
	startSweeping(intervalMs: number = SESSION_SWEEP_INTERVAL_MS): () => void {
		const timer = setInterval(() => {
			void this.sweep();
		}, intervalMs);
		timer.unref?.();
		return () => clearInterval(timer);
	}
}
