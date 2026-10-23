import { describe, expect, test } from "bun:test";
import { FIXTURE_INSIGHTS } from "@/lib/insights.fixtures";
import type { WebhookTestResult } from "@secondlayer/sdk";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebhookCompactDetailView } from "./compact-detail";
import { WebhookCompactRow, WebhooksCompactList } from "./compact-list";
import { rowModel } from "./rows";
import type { Recovery } from "./use-recovery";
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

const recovery = (over: Partial<Recovery> = {}): Recovery => ({
	dead: { count: 3, since: null },
	requeue: { busy: false, requeued: null, onRequeue: () => {} },
	...over,
});

const [receiverDown] = FIXTURE_INSIGHTS;
if (!receiverDown) throw new Error("missing insight fixture");

const renderDetail = (
	over: Partial<ComponentProps<typeof WebhookCompactDetailView>> = {},
	webhook: Parameters<typeof detail>[0] = {},
) =>
	renderToStaticMarkup(
		<WebhookCompactDetailView
			webhook={detail(webhook)}
			activity={activityFor(3)}
			deliveries={[attempt()]}
			insights={[]}
			stackAsleep={false}
			pauseBusy={false}
			onTogglePause={() => {}}
			test={{ busy: false, result: null }}
			onTest={() => {}}
			recovery={recovery()}
			replay={null}
			onReplay={() => {}}
			{...over}
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

describe("WebhookCompactRow", () => {
	test("links to the webhook's page and shows the 24 hour count", () => {
		const html = renderToStaticMarkup(
			<WebhookCompactRow row={row({ id: "a", name: "alpha" })} />,
		);
		expect(html).toContain('href="/account/webhooks/a"');
		expect(html).toContain("alpha");
		expect(html).toContain(">48<");
	});

	test("a failing webhook's name is flagged, not dotted", () => {
		const html = renderToStaticMarkup(
			<WebhookCompactRow
				row={rowModel(
					summary({ id: "a", name: "alpha", ...tripped }),
					series,
					FIXTURE_HOURS,
					[receiverDown],
				)}
			/>,
		);
		expect(html).toContain("name-flag");
	});

	test("a stopped stack reads as not delivering, not as the webhook's fault", () => {
		const html = renderToStaticMarkup(
			<WebhookCompactRow row={row({ id: "a", name: "alpha" })} stopped />,
		);
		expect(html).toContain("Not delivering, stack stopped");
		expect(html).not.toContain("name-flag");
	});
});

describe("WebhookCompactDetailView", () => {
	test("the facts are a grid of four", () => {
		const html = renderDetail();
		for (const label of ["Sent · 24h", "Gave up", "p95", "Since"]) {
			expect(html).toContain(`>${label}<`);
		}
	});

	test("a healthy webhook has Pause, Send a test and Replay, and no insight card", () => {
		const html = renderDetail();
		expect(html).toContain(">Pause<");
		expect(html).toContain(">Send a test<");
		expect(html).toContain(">Replay<");
		expect(html).not.toContain("What&#x27;s happening");
	});

	test("a paused webhook offers Resume", () => {
		expect(renderDetail({}, tripped)).toContain(">Resume<");
	});

	test("a failing webhook shows What's happening with Send a test, Requeue and Share the fix", () => {
		const html = renderDetail({ insights: [receiverDown] });
		expect(html).toContain("What&#x27;s happening");
		expect(html).toContain(">Send a test<");
		expect(html).toContain(">Requeue 3<");
		expect(html).toContain("Share the fix");
		expect(html).toContain(">Claude<");
		expect(html).toContain(">More<");
	});

	test("the phone shows no command and no copy-as-prompt link", () => {
		const html = renderDetail({ insights: [receiverDown] });
		expect(html).not.toContain("wh-cli");
		expect(html).not.toContain("Copy the fix as a prompt");
	});

	test("nothing given up leaves no Requeue", () => {
		const html = renderDetail({
			insights: [receiverDown],
			recovery: recovery({ dead: { count: 0, since: null } }),
		});
		expect(html).not.toContain(">Requeue");
	});

	test("after a requeue the card reads back how many went out", () => {
		const html = renderDetail({
			insights: [receiverDown],
			recovery: recovery({
				requeue: { busy: false, requeued: 3, onRequeue: () => {} },
			}),
		});
		expect(html).toContain("Requeued 3");
		expect(html).not.toContain(">Requeue 3<");
	});

	test("each delivery is a button that opens its payload", () => {
		const html = renderDetail();
		expect(html).toContain("mwh-drow");
		expect(html).toContain("tap one for its payload");
	});

	test("the trigger renders as plain text", () => {
		const html = renderDetail(
			{},
			{ triggers: [{ type: "stx_transfer" }, { type: "ft_transfer" }] },
		);
		expect(html).not.toContain("[object Object]");
		expect(html).toContain("+1 more");
	});

	test("a running replay gets its own section with the block range", () => {
		const html = renderDetail({
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
