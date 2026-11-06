import { describe, expect, test } from "bun:test";
import type { ReplayProgress } from "@secondlayer/shared/schemas/webhooks";
import { type ReplayView, replayTitle } from "./replay-sheet";

const running: ReplayProgress = {
	replayId: "0123456789abcdef",
	webhookId: "wh_1",
	status: "running",
	fromBlock: 9_611_409,
	toBlock: 9_612_408,
	total: 3812,
	processed: 1452,
	pending: 2360,
	delivered: null,
	gaveUp: null,
	startedAt: "2026-10-18T10:00:00.000Z",
	finishedAt: null,
	error: null,
};

describe("replay sheet", () => {
	test("the title follows the replay's status", () => {
		const view = (status: ReplayProgress["status"]): ReplayView => ({
			kind: "progress",
			progress: { ...running, status },
			minutesLeft: null,
			requeueBusy: false,
		});
		expect(replayTitle({ kind: "loading" })).toBe("Replay blocks");
		expect(replayTitle(view("running"))).toBe("Replay running");
		expect(replayTitle(view("done"))).toBe("Replay done");
		expect(replayTitle(view("failed"))).toBe("Replay failed");
	});
});
