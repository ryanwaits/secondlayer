import { describe, expect, test } from "bun:test";
import type {
	DeliveryRow,
	DoctorIssue,
	DoctorIssueCode,
	WebhookDetail,
} from "@secondlayer/sdk";
import {
	CERT_WARN_DAYS,
	handoffPrompt,
	insightsFromDoctor,
	outageStartIndex,
} from "./webhook-insights";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;

const webhook = {
	id: "wh_1",
	name: "vault-events",
	url: "https://hooks.example.dev/stacks",
	status: "active",
	circuitOpenedAt: null,
	circuitFailures: 6,
	lastError: null,
	receiverCertExpiresAt: null,
	managedBy: null,
} as unknown as WebhookDetail;

const delivery = (statusCode: number | null): DeliveryRow =>
	({ id: "d1", attempt: 1, statusCode }) as DeliveryRow;

function run(
	issues: DoctorIssue[],
	over: Partial<WebhookDetail> = {},
	deliveries: DeliveryRow[] = [delivery(502)],
) {
	return insightsFromDoctor({
		report: { issues, deadCount: 3 },
		webhook: { ...webhook, ...over },
		deliveries,
		activity: null,
		now: NOW,
	});
}

const issue = (code: DoctorIssueCode): DoctorIssue => ({
	code,
	severity: "bad",
	evidence: [{ label: "consecutive failures", value: "5" }],
	fix: { text: "Check your receiver's health and logs." },
});

describe("insightsFromDoctor severity", () => {
	for (const code of [
		"receiver_down",
		"receiver_rejects",
		"circuit",
		"dead_letters",
	] as const) {
		test(`${code} is losing`, () => {
			expect(run([issue(code)])[0]?.severity).toBe("losing");
		});
	}

	for (const code of [
		"receiver_rate_limited",
		"receiver_slow",
		"delivery_lag",
		"warning",
	] as const) {
		test(`${code} will fail`, () => {
			expect(run([issue(code)])[0]?.severity).toBe("will_fail");
		});
	}

	test("paused and no_deliveries are states, not insights", () => {
		expect(run([issue("paused"), issue("no_deliveries")])).toEqual([]);
	});

	test("last_error is losing until a newer delivery succeeds", () => {
		expect(run([issue("last_error")], {}, [delivery(502)])[0]?.severity).toBe(
			"losing",
		);
		expect(run([issue("last_error")], {}, [delivery(200)])).toEqual([]);
	});
});

describe("handoffPrompt", () => {
	test("names the webhook and host, is plain text, and ends with the fix", () => {
		const prompt = handoffPrompt(issue("receiver_down"), webhook);
		expect(prompt.startsWith('My Secondlayer webhook "vault-events"')).toBe(
			true,
		);
		expect(prompt).toContain("hooks.example.dev");
		expect(prompt).toContain("consecutive failures: 5");
		expect(prompt.endsWith("Check your receiver's health and logs.")).toBe(
			true,
		);
		expect(prompt).not.toContain("`");
	});

	test("the CLI command goes in commands, not the prompt", () => {
		const withCommand: DoctorIssue = {
			...issue("receiver_slow"),
			fix: { text: "Speed it up.", command: "secondlayer webhooks test wh_1" },
		};
		const [insight] = run([withCommand]);
		expect(insight?.handoff.commands).toEqual([
			"secondlayer webhooks test wh_1",
		]);
		expect(insight?.handoff.prompt).not.toContain("secondlayer webhooks test");
	});
});

describe("TLS certificate insight", () => {
	const expiresIn = (days: number) => new Date(NOW + days * DAY).toISOString();

	test("appears at 13 days and not at 15", () => {
		expect(CERT_WARN_DAYS).toBe(14);
		const near = run([], { receiverCertExpiresAt: expiresIn(13) });
		expect(near).toHaveLength(1);
		expect(near[0]?.severity).toBe("will_fail");
		expect(near[0]?.line).toContain("expires in 13 days");
		expect(run([], { receiverCertExpiresAt: expiresIn(15) })).toEqual([]);
	});

	test("an expired certificate is losing", () => {
		const [cert] = run([], { receiverCertExpiresAt: expiresIn(-1) });
		expect(cert?.severity).toBe("losing");
		expect(cert?.line).toContain("has expired");
	});

	test("no certificate on file, no insight", () => {
		expect(run([])).toEqual([]);
	});
});

describe("outageStartIndex", () => {
	const hour = (delivered: number, failed: number) => ({ delivered, failed });

	test("finds where the trailing run of failing hours begins", () => {
		const hours = [hour(5, 0), hour(4, 1), hour(0, 6), hour(0, 9), hour(0, 3)];
		expect(outageStartIndex(hours)).toBe(2);
	});

	test("skips idle hours at the end", () => {
		expect(outageStartIndex([hour(5, 0), hour(0, 6), hour(0, 0)])).toBe(1);
	});

	test("null when the newest active hour delivered", () => {
		expect(outageStartIndex([hour(0, 6), hour(5, 0)])).toBeNull();
	});
});
