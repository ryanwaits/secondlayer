import { describe, expect, test } from "bun:test";
import type { WebhookTestResult } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { WebhookCompactDetail } from "./compact-detail";
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

	test("the empty list says so and shows no command", () => {
		const html = renderList([]);
		expect(html).toContain("No webhooks yet");
		expect(html).not.toContain("sl ");
	});
});

describe("WebhookCompactDetail", () => {
	test("a circuit-paused webhook shows the three steps, Resume and Replay disabled", () => {
		const html = renderDetail(tripped);
		expect(html).toContain("Can&#x27;t reach your server");
		expect(html).toContain("Get it delivering again");
		expect(html).toContain("Send a test event");
		expect(html).toContain("Resume deliveries");
		expect(html).toContain("Replay what failed");
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Resume</);
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Replay</);
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
