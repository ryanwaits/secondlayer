import { describe, expect, test } from "bun:test";
import {
	type IncidentEmailItem,
	buildWebhookIncidentEmail,
} from "./webhook-incident-email.ts";

const item = (over: Partial<IncidentEmailItem> = {}): IncidentEmailItem => ({
	id: "11111111-1111-4111-8111-111111111111",
	name: "orders",
	host: "hooks.example.com",
	failingSince: new Date("2026-10-15T09:05:00Z"),
	failures: 12,
	lastError: "HTTP 503",
	...over,
});

function noDashes(email: { subject: string; html: string; text: string }) {
	for (const part of [email.subject, email.html, email.text]) {
		expect(part).not.toContain("—");
		expect(part).not.toContain("–");
	}
}

describe("buildWebhookIncidentEmail", () => {
	test("single webhook names the receiver, time and links to the webhook", () => {
		const email = buildWebhookIncidentEmail([item()]);
		expect(email.subject).toBe(`Your webhook "orders" can't reach your server`);
		expect(email.text).toContain("Oct 15, 09:05 UTC");
		expect(email.text).toContain("hooks.example.com");
		expect(email.text).toContain("Failed attempts in a row");
		expect(email.text).toContain("HTTP 503");
		expect(email.html).toContain(
			"https://secondlayer.tools/account/webhooks/11111111-1111-4111-8111-111111111111",
		);
		noDashes(email);
	});

	test("omits the last error row when there is none", () => {
		const email = buildWebhookIncidentEmail([item({ lastError: null })]);
		expect(email.text).not.toContain("Last error");
		noDashes(email);
	});

	test("several webhooks list each one and link to the webhooks page", () => {
		const email = buildWebhookIncidentEmail([
			item(),
			item({ id: "b", name: "payments", host: "pay.example.com" }),
		]);
		expect(email.subject).toBe("2 of your webhooks can't reach your server");
		expect(email.text).toContain(`"orders" (hooks.example.com)`);
		expect(email.text).toContain(`"payments" (pay.example.com)`);
		expect(email.html).toContain("https://secondlayer.tools/account/webhooks");
		expect(email.html).not.toContain("/account/webhooks/1111");
		noDashes(email);
	});
});
