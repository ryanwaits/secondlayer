import { describe, expect, test } from "bun:test";
import type { WebhookTestResult } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import {
	type CompactReplayProps,
	WebhookCompactDetail,
	WebhookCompactDetailView,
} from "./compact-detail";
import { WebhooksCompactList } from "./compact-list";
import { rowModel } from "./rows";
import {
	FIXTURE_HOURS,
	activityFor,
	attempt,
	detail,
	summary,
} from "./webhook.fixtures";

const series = {
	delivered: new Array<number>(168).fill(2),
	failed: new Array<number>(168).fill(0),
};
const row = (over: Parameters<typeof summary>[0]) =>
	rowModel(summary(over), series, FIXTURE_HOURS, []);

const tripped = {
	status: "paused",
	circuitOpenedAt: "2026-10-15T11:40:00.000Z",
	circuitFailures: 20,
	lastError: "502 Bad Gateway",
} as const;

const renderList = (rows: ReturnType<typeof row>[] | null, failing = 0) =>
	renderToStaticMarkup(
		<WebhooksCompactList
			rows={rows}
			failing={failing}
			busyId={null}
			onOpen={() => {}}
			onTogglePause={() => {}}
		/>,
	);

const passed: WebhookTestResult = {
	ok: true,
	statusCode: 200,
	error: null,
	durationMs: 184,
	deliveryId: "d_test",
};

const renderDetail = (
	over: Parameters<typeof detail>[0] = {},
	result: WebhookTestResult | null = null,
) =>
	renderToStaticMarkup(
		<WebhookCompactDetail
			webhook={detail(over)}
			activity={activityFor(3)}
			deliveries={[attempt()]}
			pauseBusy={false}
			onTogglePause={() => {}}
			test={{ busy: false, result }}
			onTest={() => {}}
		/>,
	);

describe("WebhooksCompactList", () => {
	test("one row per webhook, and the failing count in the subtitle", () => {
		const html = renderList(
			[
				row({ id: "a", name: "alpha", ...tripped }),
				row({ id: "b", name: "beta", ...tripped }),
				row({ id: "c", name: "gamma" }),
			],
			2,
		);
		for (const name of ["alpha", "beta", "gamma"]) expect(html).toContain(name);
		expect(html).toContain("3 webhooks · 2 failing");
	});

	test("a paused row swipes to Resume, an active row to Pause", () => {
		const html = renderList([
			row({ id: "a", name: "alpha" }),
			row({ id: "b", name: "beta", status: "paused" }),
		]);
		expect(html.split(">Pause<").length - 1).toBe(1);
		expect(html.split(">Resume<").length - 1).toBe(1);
	});

	test("every row has two swipe actions, Pause or Resume and Replay", () => {
		const html = renderList([
			row({ id: "a", name: "alpha" }),
			row({ id: "b", name: "beta", status: "paused" }),
		]);
		expect(html.split(">Replay<").length - 1).toBe(2);
		expect(html).toContain("Swipe left on a webhook for Pause and Replay.");
	});

	test("the empty list says so and shows no command", () => {
		const html = renderList([]);
		expect(html).toContain("No webhooks yet");
		expect(html).not.toContain("sl ");
	});
});

describe("WebhookCompactDetail", () => {
	test("a circuit-paused webhook shows the three steps, Resume and Requeue disabled", () => {
		const html = renderDetail(tripped);
		expect(html).toContain("Can&#x27;t reach your server");
		expect(html).toContain("Get it delivering again");
		expect(html).toContain("Send a test event");
		expect(html).toContain("Resume deliveries");
		expect(html).toContain("Requeue what gave up");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Resume</);
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Requeue</);
		expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Send test</);
		expect(html).toContain("Test first.");
	});

	test("a passing test reads back and unlocks Resume", () => {
		const html = renderDetail(tripped, passed);
		expect(html).toContain("Test got 200 in 184 ms");
		expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Resume</);
		expect(html).not.toContain("Test first.");
	});

	test("a healthy webhook has no recovery steps", () => {
		const html = renderDetail();
		expect(html).not.toContain("Get it delivering again");
		expect(html).toContain("Delivering");
		expect(html).toContain(">Pause<");
		expect(html).toContain(">Send test<");
	});

	test("the trigger renders as plain text", () => {
		const html = renderDetail({
			triggers: [{ type: "stx_transfer" }, { type: "ft_transfer" }],
		});
		expect(html).not.toContain("[object Object]");
		expect(html).toContain("+1 more");
	});
});

describe("WebhookCompactDetailView recovery step 3", () => {
	const recovery = (
		over: Partial<CompactReplayProps>,
		webhook: Parameters<typeof detail>[0] = {},
	) =>
		renderToStaticMarkup(
			<WebhookCompactDetailView
				webhook={detail(webhook)}
				activity={activityFor(3)}
				deliveries={[attempt()]}
				pauseBusy={false}
				onTogglePause={() => {}}
				test={{ busy: false, result: passed }}
				onTest={() => {}}
				showRecovery
				dead={{ count: 3 }}
				requeue={{ busy: false, requeued: null, onRequeue: () => {} }}
				replay={null}
				onReplay={() => {}}
				{...over}
			/>,
		);

	test("resumed with 3 given up shows an enabled Requeue 3", () => {
		const html = recovery({});
		expect(html).toContain("Requeue what gave up");
		expect(html).toContain(">Requeue 3<");
		expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Requeue 3</);
	});

	test("still paused keeps Requeue disabled", () => {
		const html = recovery({}, tripped);
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Requeue 3</);
	});

	test("nothing given up says so", () => {
		const html = recovery({ dead: { count: 0 } });
		expect(html).toContain("Nothing gave up");
		expect(html).toContain("Waiting events went out when you resumed.");
		expect(html).not.toContain("Requeue");
	});

	test("after a requeue the step reads back how many went out", () => {
		const html = recovery({
			requeue: { busy: false, requeued: 3, onRequeue: () => {} },
		});
		expect(html).toContain("Requeued 3");
		expect(html).not.toContain(">Requeue 3<");
	});

	test("a healthy webhook has an outline Replay button beside Pause and Send test", () => {
		const html = recovery({ showRecovery: false });
		expect(html).toContain(">Pause<");
		expect(html).toContain(">Send test<");
		expect(html).toContain(">Replay<");
	});

	test("a running replay gets its own section with the block range", () => {
		const html = recovery({
			showRecovery: false,
			replay: {
				minutesLeft: 4,
				progress: {
					replayId: "0123456789abcdef",
					webhookId: "wh_1",
					status: "running",
					fromBlock: 9_611_880,
					toBlock: 9_612_408,
					total: 3812,
					processed: 1452,
					pending: 2360,
					delivered: null,
					gaveUp: null,
					startedAt: "2026-10-18T10:00:00.000Z",
					finishedAt: null,
					error: null,
				},
			},
		});
		expect(html).toContain("blocks 9,611,880 → 9,612,408");
		expect(html).toContain("of 3,812 sent");
		expect(html).toContain("About 4 min left.");
	});
});
