import { describe, expect, test } from "bun:test";
import { Index } from "../index.ts";
import type { IndexEvent, IndexFtTransfer, IndexPrint } from "../index.ts";

/**
 * Compile-time guarantees, not runtime ones: passing a literal `eventType`
 * must narrow every surface to that event's own shape, so handlers stop
 * opening with `if (e.event_type !== …) continue`.
 *
 * The assertions below are type assignments — `bun run typecheck` is what
 * actually enforces them. The runtime bodies never execute; the `expect` at
 * the end just keeps this a real, reported test.
 */

const index = new Index();

async function narrowsConsume(): Promise<void> {
	await index.events.consume({
		eventType: "ft_transfer",
		onBatch: (events) => {
			// Assignable with no guard — this is the whole point.
			const rows: IndexFtTransfer[] = events;
			// `amount` exists only on ft_transfer.
			void rows.reduce((n, e) => n + BigInt(e.amount), 0n);
		},
	});

	await index.events.consume({
		eventType: "print",
		onBatch: (events) => {
			const rows: IndexPrint[] = events;
			// `payload.topic` exists only on print.
			void rows.map((e) => e.payload.topic);
		},
	});
}

async function narrowsWalkAndList(): Promise<void> {
	for await (const event of index.events.walk({ eventType: "print" })) {
		void event.payload.topic;
	}
	const page = await index.events.list({ eventType: "ft_transfer" });
	void page.events[0]?.amount;
}

async function keepsTheUnionWhenTypeIsDynamic(
	eventType: "ft_transfer" | "print",
): Promise<void> {
	await index.events.consume({
		eventType,
		onBatch: (events) => {
			// No false narrowing: a non-literal event_type still yields a union
			// that has to be discriminated before member fields are reachable.
			const rows: (IndexFtTransfer | IndexPrint)[] = events;
			void rows.map((e) => (e.event_type === "print" ? e.payload : e.amount));
		},
	});
}

async function stillAcceptsTheWholeUnion(): Promise<void> {
	const page = await index.events.list({
		eventType: "ft_transfer" as IndexEvent["event_type"],
	});
	const rows: IndexEvent[] = page.events;
	void rows;
}

describe("event type narrowing", () => {
	test("literal eventType narrows consume, walk, and list at compile time", () => {
		// Referencing the helpers keeps them checked without hitting the network.
		expect(
			[
				narrowsConsume,
				narrowsWalkAndList,
				keepsTheUnionWhenTypeIsDynamic,
				stillAcceptsTheWholeUnion,
			].every((fn) => typeof fn === "function"),
		).toBe(true);
	});
});
