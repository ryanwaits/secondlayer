import { describe, expect, test } from "bun:test";
import { applyQueueEvent, emptyQueueState, queueCaughtUp } from "./queue.ts";

describe("queue coverage", () => {
	test("happy path accept → decide → enqueue → deliver", () => {
		let state = emptyQueueState();
		for (const event of [
			{ type: "accept" as const },
			{ type: "decide" as const, matched: true },
			{ type: "enqueue" as const },
			{ type: "deliver" as const },
		]) {
			const next = applyQueueEvent(state, event);
			expect(next.ok).toBe(true);
			if (next.ok) state = next.state;
		}
		expect(queueCaughtUp(state)).toBe(true);
	});

	test("dedupe ignores a repeated accept with the same key", () => {
		let state = emptyQueueState();
		const first = applyQueueEvent(state, { type: "accept" }, "dup");
		if (!first.ok) throw new Error(first.reason);
		state = first.state;
		const again = applyQueueEvent(state, { type: "accept" }, "dup");
		expect(again.ok).toBe(true);
		if (again.ok) expect(again.state.accepted).toBe(1);
	});

	test("dlq then requeue then deliver", () => {
		let state = emptyQueueState();
		for (const event of [
			{ type: "accept" as const },
			{ type: "decide" as const, matched: true },
			{ type: "enqueue" as const },
			{ type: "dead" as const },
			{ type: "requeue" as const },
			{ type: "deliver" as const },
		]) {
			const next = applyQueueEvent(state, event);
			expect(next.ok).toBe(true);
			if (next.ok) state = next.state;
		}
		expect(state.delivered).toBe(1);
		expect(state.dead).toBe(0);
	});

	test("rollback and replay set the cursor fence", () => {
		const rolled = applyQueueEvent(emptyQueueState(), { type: "rollback" });
		expect(rolled.ok).toBe(true);
		if (rolled.ok) expect(rolled.state.stage).toBe("rollback");
		const replayed = applyQueueEvent(emptyQueueState(), {
			type: "replay",
			cursor: "100:0",
		});
		expect(replayed.ok).toBe(true);
		if (replayed.ok) {
			expect(replayed.state.stage).toBe("replay");
			expect(replayed.state.fence_cursor).toBe("100:0");
		}
	});

	test("deliver without enqueue is refused", () => {
		expect(applyQueueEvent(emptyQueueState(), { type: "deliver" }).ok).toBe(
			false,
		);
	});

	test("unmatched decisions do not block catch-up", () => {
		let state = emptyQueueState();
		for (const event of [
			{ type: "accept" as const },
			{ type: "decide" as const, matched: false },
			{ type: "accept" as const },
			{ type: "decide" as const, matched: true },
			{ type: "enqueue" as const },
			{ type: "deliver" as const },
		]) {
			const next = applyQueueEvent(state, event);
			expect(next.ok).toBe(true);
			if (next.ok) state = next.state;
		}
		expect(queueCaughtUp(state)).toBe(true);
	});
});
