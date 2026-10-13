import { describe, expect, test } from "bun:test";
import type { WebhookSummary } from "@secondlayer/sdk";
import { accountSummary, keyHint, receiverHost } from "./docs-account-summary";
import type { ApiKey } from "./types";

function key(over: Partial<ApiKey> = {}): ApiKey {
	return {
		id: "k1",
		prefix: "sk-sl_7f3a",
		name: "laptop",
		status: "active",
		product: "account",
		tier: null,
		createdAt: "2026-10-01T00:00:00Z",
		lastUsedAt: null,
		// A stray full-key field must never be read.
		...({ key: "sk-sl_7f3a-FULL-SECRET-KEY" } as object),
		...over,
	};
}

function hook(over: Partial<WebhookSummary> = {}): WebhookSummary {
	return {
		id: "w1",
		name: "sbtc-deposits",
		status: "active",
		kind: "chain",
		format: "standard-webhooks",
		url: "https://hooks.acme.dev/services/T000/B000/s3cr3t-token?sig=abc",
		lastDeliveryAt: null,
		lastSuccessAt: null,
		circuitOpenedAt: null,
		circuitFailures: 0,
		createdAt: "2026-10-01T00:00:00Z",
		updatedAt: "2026-10-01T00:00:00Z",
		...over,
	} as WebhookSummary;
}

describe("accountSummary", () => {
	test("names the key by name and prefix only, never a full key", () => {
		const out = accountSummary({ keys: [key()], webhooks: [] });
		expect(out).toContain('Key: "laptop" sk-sl_7f3a…');
		expect(out).not.toContain("FULL-SECRET");
	});

	test("shows only the host of a webhook receiver, never the path or token", () => {
		const out = accountSummary({ keys: null, webhooks: [hook()] });
		expect(out).toBe("Webhook sbtc-deposits → hooks.acme.dev (active)");
		expect(out).not.toContain("s3cr3t-token");
		expect(out).not.toContain("https://");
		expect(out).not.toContain("/services");
	});

	test("reports consecutive failures", () => {
		const out = accountSummary({
			keys: null,
			webhooks: [hook({ circuitFailures: 2 })],
		});
		expect(out).toContain("(active, 2 failing)");
	});

	test("lists an attached webhook before the key and the others", () => {
		const out = accountSummary({
			keys: [key()],
			webhooks: [
				hook({ id: "w1", name: "first" }),
				hook({ id: "w2", name: "second" }),
			],
			attached: ["w2"],
		});
		const lines = out.split("\n");
		expect(lines[0]).toStartWith("Webhook second");
		expect(lines[1]).toStartWith("Key:");
		expect(lines[2]).toStartWith("Webhook first");
	});

	test("caps at 1500 characters on whole lines", () => {
		const many = Array.from({ length: 80 }, (_, i) =>
			hook({ id: `w${i}`, name: `webhook-number-${i}` }),
		);
		const out = accountSummary({ keys: null, webhooks: many });
		expect(out.length).toBeLessThanOrEqual(1500);
		expect(out.split("\n").every((l) => l.startsWith("Webhook "))).toBe(true);
	});

	test("skips revoked keys", () => {
		expect(keyHint([key({ status: "revoked" })])).toBeNull();
		expect(
			accountSummary({ keys: [key({ status: "revoked" })], webhooks: null }),
		).toBe("");
	});
});

describe("receiverHost", () => {
	test("drops userinfo and returns null for junk", () => {
		expect(receiverHost("https://user:pw@hooks.acme.dev:8443/x")).toBe(
			"hooks.acme.dev:8443",
		);
		expect(receiverHost("not a url")).toBeNull();
	});
});
