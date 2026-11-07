import { describe, expect, test } from "bun:test";
import {
	SAVE_IDLE,
	type SaveEvent,
	type SaveState,
	pendingValue,
	saveReducer,
} from "./save-state";

const run = (events: SaveEvent<number>[]) =>
	events.reduce(saveReducer<number>, SAVE_IDLE as SaveState<number>);

describe("saveReducer", () => {
	test("a save is pending with its value until its answer comes", () => {
		const saving = run([{ type: "start", seq: 1, next: 50 }]);
		expect(pendingValue(saving)).toBe(50);
		expect(
			run([
				{ type: "start", seq: 1, next: 50 },
				{ type: "done", seq: 1 },
			]),
		).toMatchObject({ status: "idle" });
	});

	test("a failed save stops showing its value and keeps the reason", () => {
		const failed = run([
			{ type: "start", seq: 1, next: 50 },
			{ type: "fail", seq: 1, error: "offline" },
		]);
		expect(failed).toMatchObject({ status: "failed", error: "offline" });
		expect(pendingValue(failed)).toBeUndefined();
	});

	test("an older save's answer is dropped once a newer save started", () => {
		const events: SaveEvent<number>[] = [
			{ type: "start", seq: 1, next: 50 },
			{ type: "start", seq: 2, next: 75 },
			{ type: "done", seq: 1 },
		];
		expect(pendingValue(run(events))).toBe(75);
		expect(
			pendingValue(run([...events, { type: "fail", seq: 1, error: "x" }])),
		).toBe(75);
	});

	test("the newest save's answer settles it even when it arrives first", () => {
		const settled = run([
			{ type: "start", seq: 1, next: 50 },
			{ type: "start", seq: 2, next: 75 },
			{ type: "done", seq: 2 },
			{ type: "fail", seq: 1, error: "late" },
		]);
		expect(settled).toMatchObject({ seq: 2, status: "idle" });
	});

	test("answers with nothing in flight, and out-of-order starts, change nothing", () => {
		expect(run([{ type: "done", seq: 1 }])).toBe(SAVE_IDLE);
		expect(run([{ type: "fail", seq: 1, error: "x" }])).toBe(SAVE_IDLE);
		const saving = run([{ type: "start", seq: 2, next: 1 }]);
		expect(saveReducer(saving, { type: "start", seq: 1, next: 9 })).toBe(
			saving,
		);
	});
});
