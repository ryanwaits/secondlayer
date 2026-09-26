import { describe, expect, test } from "bun:test";
import type { DoctorIssue, WebhookDetail } from "@secondlayer/sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosisPanel } from "./diagnosis";

const webhook: WebhookDetail = {
	id: "wh-1",
	name: "pool-payouts",
	status: "active",
	kind: "subgraph",
	subgraphName: "pool",
	tableName: "payouts",
	triggers: null,
	format: "standard-webhooks",
	runtime: "node",
	url: "https://example.com/webhook",
	lastDeliveryAt: null,
	lastSuccessAt: null,
	circuitOpenedAt: null,
	createdAt: "2026-04-01T00:00:00.000Z",
	updatedAt: "2026-04-01T00:00:00.000Z",
	filter: {},
	authConfig: {},
	maxRetries: 7,
	timeoutMs: 10_000,
	concurrency: 8,
	circuitFailures: 2,
	lastError: null,
	warning: null,
};

describe("DiagnosisPanel", () => {
	test("renders nothing when there is no primary issue", () => {
		const html = renderToStaticMarkup(
			<DiagnosisPanel
				webhook={webhook}
				issues={[]}
				primary={null}
				deadCount={0}
			/>,
		);
		expect(html).toBe("");
	});

	test("renders the primary's title, evidence, and fix (a new detector)", () => {
		const primary: DoctorIssue = {
			code: "receiver_rate_limited",
			severity: "warn",
			evidence: [
				{ label: "429 responses", value: "6 of 10 attempts" },
				{ label: "window", value: "2026-04-23 00:00:00 → 2026-04-23 00:01:00" },
			],
			fix: {
				text: "Lower concurrency, or honor the Retry-After header on your receiver.",
				command: `secondlayer webhooks update ${webhook.id} --concurrency 4`,
				docsPath: "/docs/webhooks#receiver-rate-limited",
			},
		};
		const html = renderToStaticMarkup(
			<DiagnosisPanel
				webhook={webhook}
				issues={[primary]}
				primary={primary}
				deadCount={0}
			/>,
		);
		expect(html).toContain("Your receiver is rate-limiting us");
		expect(html).toContain("6 of 10 attempts were 429 responses");
		expect(html).toContain("429 responses");
		expect(html).toContain("Lower concurrency");
		expect(html).toContain(`webhooks update ${webhook.id} --concurrency 4`);
		expect(html).toContain("/docs/webhooks#receiver-rate-limited");
		expect(html).toContain("How we worked this out");
		expect(html).toContain("wh-insight warn");
	});

	test("keeps the legacy sentence and severity tint for an existing flag code (circuit)", () => {
		const primary: DoctorIssue = { code: "circuit", severity: "bad" };
		const html = renderToStaticMarkup(
			<DiagnosisPanel
				webhook={webhook}
				issues={[primary]}
				primary={primary}
				deadCount={0}
			/>,
		);
		expect(html).toContain("Your receiver is failing");
		expect(html).toContain("failed 2 times in a row");
		expect(html).toContain("wh-insight bad");
		// No evidence array on this code — no evidence block rendered.
		expect(html).not.toContain("wh-insight-evidence");
	});

	test("collapses the rest of the issues under the primary", () => {
		const primary: DoctorIssue = { code: "circuit", severity: "bad" };
		const secondary: DoctorIssue = { code: "dead_letters", severity: "bad" };
		const html = renderToStaticMarkup(
			<DiagnosisPanel
				webhook={webhook}
				issues={[primary, secondary]}
				primary={primary}
				deadCount={3}
			/>,
		);
		expect(html).toContain("1 more thing to check");
		expect(html).toContain("Some events exhausted every retry");
	});
});
