import { describe, expect, test } from "bun:test";
import type { WebhookActivity, WebhookDetail } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigSummaryLine } from "./config-card";

const base: WebhookDetail = {
	id: "wh-1",
	name: "gate1-latency",
	status: "active",
	kind: "chain",
	subgraphName: null,
	tableName: null,
	triggers: [{ type: "stx_transfer" }],
	format: "standard-webhooks",
	runtime: null,
	url: "https://example.com/webhook",
	lastDeliveryAt: null,
	lastSuccessAt: null,
	circuitOpenedAt: null,
	createdAt: "2026-09-25T00:00:00.000Z",
	updatedAt: "2026-09-25T00:00:00.000Z",
	filter: {},
	auth: { type: "none", headerNames: [], hasSecret: false },
	maxRetries: 7,
	timeoutMs: 10_000,
	concurrency: 4,
	circuitFailures: 0,
	lastError: null,
	warning: null,
};

const activity: WebhookActivity = {
	hours: [],
	waiting: 0,
	nextAttemptAt: null,
	lastSuccessAt: null,
	byEventType: {
		"chain.stx_transfer.apply": 83_923,
		"chain.ft_transfer.apply": 700,
	},
};

function render(webhook: WebhookDetail) {
	return renderToStaticMarkup(
		<ConfigSummaryLine
			webhook={webhook}
			activity={activity}
			onOpen={() => {}}
		/>,
	);
}

describe("ConfigSummaryLine", () => {
	test("an unfiltered webhook shows its daily volume on the same line, once", () => {
		const html = render(base);
		expect(html).toContain("no filters");
		expect(html).toContain("wh-sumline-warn");
		expect(html).toContain("11,989");
		expect(html.match(/See configuration/g)?.length).toBe(1);
	});

	test("a fully filtered webhook shows no volume warning", () => {
		const html = render({
			...base,
			triggers: [{ type: "stx_transfer", sender: "SP1ABC" }],
		});
		expect(html).not.toContain("wh-sumline-warn");
		expect(html).toContain("1 filter");
	});

	test("a mix names how many triggers are unfiltered and counts only those", () => {
		const html = render({
			...base,
			triggers: [
				{ type: "stx_transfer" },
				{ type: "ft_transfer", recipient: "SP1ABC" },
			],
		});
		expect(html).toContain("1 trigger unfiltered");
		expect(html).toContain("11,989");
		expect(html).not.toContain("12,089");
	});
});
