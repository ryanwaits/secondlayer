import { describe, expect, test } from "bun:test";
import type {
	ReplayProgress,
	ReplayRanges,
} from "@secondlayer/shared/schemas/webhooks";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ReplayBody,
	ReplayProgressView,
	type ReplayView,
	replayTitle,
} from "./replay-sheet";

const ranges: ReplayRanges = {
	tip: 9_612_408,
	presets: [
		{ blocks: 100, fromBlock: 9_612_309, toBlock: 9_612_408, knownEvents: 380 },
		{
			blocks: 1000,
			fromBlock: 9_611_409,
			toBlock: 9_612_408,
			knownEvents: 3812,
		},
		{
			blocks: 10000,
			fromBlock: 9_602_409,
			toBlock: 9_612_408,
			knownEvents: 84_210,
		},
	],
	deadSinceFailing: { since: null, count: 0 },
};

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

const noop = () => {};
const render = (view: ReplayView) =>
	renderToStaticMarkup(
		<ReplayBody
			view={view}
			onClose={noop}
			onSelect={noop}
			onStart={noop}
			onRequeue={noop}
		/>,
	);

describe("replay sheet", () => {
	test("the picker shows three presets, 1,000 checked, and the estimate", () => {
		const html = render({
			kind: "picker",
			ranges,
			selected: 1000,
			busy: false,
		});
		expect(html).toContain("Last 100 blocks");
		expect(html).toContain("Last 1,000 blocks");
		expect(html).toContain("Last 10,000 blocks");
		expect(html).toContain("blocks 9,611,409 → 9,612,408");
		expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
		expect(html).toMatch(/aria-checked="true"[^>]*class="mrp-radio"/);
		expect(html).toContain("About 3,812 events · $0.04");
		expect(html).toContain(">Replay 1,000 blocks<");
		expect(html).toContain("Pick exact blocks on desktop.");
	});

	test("the 10,000 block preset reads as a lower bound", () => {
		const html = render({
			kind: "picker",
			ranges,
			selected: 10000,
			busy: false,
		});
		expect(html).toContain("At least 84,210 events · $0.84");
	});

	test("a webhook that has seen no block has no presets and no button", () => {
		const html = render({
			kind: "picker",
			ranges: { ...ranges, tip: null, presets: [] },
			selected: 1000,
			busy: false,
		});
		expect(html).toContain("hasn&#x27;t seen a block yet");
		expect(html).not.toContain("<button");
	});

	test("a failing server gates the picker", () => {
		const html = render({ kind: "gated" });
		expect(html).toContain("Your server is still failing");
		expect(html).toContain("A replay now would fail too.");
		expect(html).toContain(">Close<");
		expect(html).not.toMatch(/>Replay[ <]/);
	});

	test("progress while running shows sent over total and no gave up", () => {
		const html = render({
			kind: "progress",
			progress: running,
			minutesLeft: 3,
			requeueBusy: false,
		});
		expect(html).toContain("1,452");
		expect(html).toContain("of 3,812 sent");
		expect(html).toContain("About 3 min left.");
		expect(html).toContain("Queued 3,812 events from 1,000 blocks");
		expect(html).toContain("38%");
		expect(html).toContain('style="width:38%"');
		expect(html).not.toContain("gave up");
	});

	test("the minutes clause is left out until it is known", () => {
		const html = renderToStaticMarkup(
			<ReplayProgressView
				progress={running}
				minutesLeft={null}
				onRequeue={noop}
			/>,
		);
		expect(html).not.toContain("min left");
		expect(html).toContain("You can leave; this keeps going.");
	});

	test("done with gave up shows both counts and a Requeue action", () => {
		const html = render({
			kind: "progress",
			progress: {
				...running,
				status: "done",
				processed: 3812,
				pending: 0,
				delivered: 3790,
				gaveUp: 22,
				finishedAt: "2026-10-18T10:07:00.000Z",
			},
			minutesLeft: null,
			requeueBusy: false,
		});
		expect(html).toContain("3,790");
		expect(html).toContain("delivered");
		expect(html).toContain("22 gave up");
		expect(html).toContain(">Requeue 22<");
	});

	test("done with nothing given up says everything was delivered", () => {
		const html = render({
			kind: "progress",
			progress: {
				...running,
				status: "done",
				processed: 3812,
				pending: 0,
				delivered: 3812,
				gaveUp: 0,
			},
			minutesLeft: null,
			requeueBusy: false,
		});
		expect(html).toContain("Everything was delivered.");
		expect(html).not.toContain("Requeue");
		expect(html).not.toContain("gave up");
	});

	test("a failed replay says why and offers Close", () => {
		const html = render({
			kind: "progress",
			progress: { ...running, status: "failed", error: "scan timed out" },
			minutesLeft: null,
			requeueBusy: false,
		});
		expect(html).toContain("The replay stopped: scan timed out");
		expect(html).toContain(">Close<");
	});

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
