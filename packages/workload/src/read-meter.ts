/**
 * Counting for the `subgraph.read` meter: one successful read of a hosted
 * subgraph table, made with an account API key, is one read.
 *
 * The workload gateway counts, never the tenant stack. A tenant's API
 * `import()`s the customer's own handler code at deploy, so anything the
 * tenant reports about billing could be rewritten by the customer. The
 * gateway sees every request and response before the tenant's code can
 * change what the customer is charged.
 *
 * Pure and injectable: no clock, no network. `gateway.ts` wires it in and
 * `meters.ts` turns drained counts into `/internal/meters` items.
 */

import {
	SUBGRAPH_STREAM_BATCH_ROWS,
	SUBGRAPH_STREAM_POLL_MS,
} from "@secondlayer/platform/billing/prices";

/** `/v1/subgraphs/:name/<x>` answers metadata, not rows, for exactly these. */
const METADATA_SEGMENTS: ReadonlySet<string> = new Set([
	"openapi.json",
	"schema.json",
	"docs.md",
]);

/**
 * Does this request read rows from a hosted subgraph table?
 *
 *  - `"read"`: one response, one read.
 *  - `"stream"`: counted per delivered batch (`createSseBatchCounter`);
 *    opening the stream is free.
 *  - `null`: free (metadata, every other path, any non-GET).
 *
 * Any new hosted route that returns table rows must be added here, or it
 * becomes a free bypass.
 */
export function classifyBillableRead(
	method: string,
	pathname: string,
): "read" | "stream" | null {
	if (method !== "GET") return null;
	const path =
		pathname.length > 1 && pathname.endsWith("/")
			? pathname.slice(0, -1)
			: pathname;
	const segments = path.split("/").slice(1);

	// /api/subgraphs/:name/recent
	if (
		segments.length === 4 &&
		segments[0] === "api" &&
		segments[1] === "subgraphs" &&
		segments[3] === "recent"
	) {
		return "read";
	}

	if (segments[0] !== "v1" || segments[1] !== "subgraphs") return null;
	// segments: v1, subgraphs, :name, then the rest
	const rest = segments.slice(3);
	if (segments.length < 4 || segments[2] === "") return null;
	const table = rest[0];
	if (table === undefined || table === "") return null;
	if (rest.length === 1) {
		return METADATA_SEGMENTS.has(table) ? null : "read";
	}
	if (rest.length === 2) {
		const tail = rest[1];
		if (tail === undefined || tail === "") return null;
		if (tail === "stream") return "stream";
		// count, aggregate, or a row id
		return "read";
	}
	return null;
}

/**
 * Counts how many batches a table stream has delivered, from the bytes the
 * gateway relays. `handleTableStream` polls every `SUBGRAPH_STREAM_POLL_MS`
 * and writes up to `SUBGRAPH_STREAM_BATCH_ROWS` rows back to back, so a new
 * batch starts when rows resume after a pause of half a poll or more, or
 * when the current batch is already full.
 *
 * Frames are SSE blocks ending in a blank line. A heartbeat (`event: ping`
 * with an empty `data:`) is not a row. Frames split across chunks are
 * buffered until their blank line arrives.
 *
 * It cannot be gamed downward: a tampered tenant cannot get under
 * rows / SUBGRAPH_STREAM_BATCH_ROWS, and pacing rows out only adds batches.
 * Client backpressure can merge two honest batches into one, which
 * undercounts in the customer's favor.
 */
export function createSseBatchCounter(opts: { now: () => number }): {
	push(chunk: Uint8Array): number;
} {
	const decoder = new TextDecoder();
	let buffer = "";
	let lastRowAt: number | null = null;
	let batchRows = 0;

	function isRow(frame: string): boolean {
		const lines = frame.split("\n").filter((line) => line !== "");
		if (lines.length === 0) return false;
		let sawPing = false;
		for (const line of lines) {
			const colon = line.indexOf(":");
			const field = colon === -1 ? line : line.slice(0, colon);
			const value = colon === -1 ? "" : line.slice(colon + 1).trim();
			if (field === "event" && value === "ping") sawPing = true;
			else if (field === "data" && value === "") continue;
			else return true;
		}
		return !sawPing;
	}

	return {
		push(chunk) {
			buffer += decoder.decode(chunk, { stream: true });
			buffer = buffer.replace(/\r\n/g, "\n");
			let started = 0;
			for (;;) {
				const end = buffer.indexOf("\n\n");
				if (end === -1) break;
				const frame = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				if (!isRow(frame)) continue;
				const at = opts.now();
				if (
					lastRowAt === null ||
					at - lastRowAt >= SUBGRAPH_STREAM_POLL_MS / 2 ||
					batchRows >= SUBGRAPH_STREAM_BATCH_ROWS
				) {
					started++;
					batchRows = 0;
				}
				batchRows++;
				lastRowAt = at;
			}
			return started;
		},
	};
}

/** Reads counted since the last drain, per account and API key. */
export class ReadCounter {
	private counts = new Map<
		string,
		{ accountId: string; apiKeyId: string; count: number }
	>();

	/** Add `n` reads (non-finite or non-positive is ignored, fractions floor). */
	add(accountId: string, apiKeyId: string, n: number): void {
		if (!Number.isFinite(n) || n <= 0) return;
		const whole = Math.floor(n);
		if (whole <= 0) return;
		const key = `${accountId}\0${apiKeyId}`;
		const entry = this.counts.get(key);
		if (entry) entry.count += whole;
		else this.counts.set(key, { accountId, apiKeyId, count: whole });
	}

	/** Read and zero, so a flush never double-counts what it already sent. */
	drain(): Array<{ accountId: string; apiKeyId: string; count: number }> {
		const out = [...this.counts.values()];
		this.counts = new Map();
		return out;
	}
}
