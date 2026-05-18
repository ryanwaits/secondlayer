import { describe, expect, test } from "bun:test";
import { sign } from "@secondlayer/shared/crypto/standard-webhooks";
import { verifyWebhookSignature } from "../webhooks.ts";

describe("verifyWebhookSignature", () => {
	const secret = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtMzItYnl0ZXMtbG9uZw==";
	const payload = JSON.stringify({
		type: "stx-transfers.transfers.created",
		timestamp: new Date().toISOString(),
		data: { amount: "1000000", sender: "SP123", recipient: "SP456" },
	});

	test("returns true for valid Standard Webhooks signature (plain object)", () => {
		const headers = sign(payload, secret);
		expect(verifyWebhookSignature(payload, headers, secret)).toBe(true);
	});

	test("accepts Fetch Headers instance", () => {
		const signed = sign(payload, secret);
		const headers = new Headers(signed as unknown as Record<string, string>);
		expect(verifyWebhookSignature(payload, headers, secret)).toBe(true);
	});

	test("accepts a header lookup callback", () => {
		const signed = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				(name) => (signed as unknown as Record<string, string>)[name],
				secret,
			),
		).toBe(true);
	});

	test("header name matching is case-insensitive", () => {
		const signed = sign(payload, secret);
		const upper: Record<string, string> = {};
		for (const [k, v] of Object.entries(signed)) {
			upper[k.toUpperCase()] = v;
		}
		expect(verifyWebhookSignature(payload, upper, secret)).toBe(true);
	});

	test("works with a non-prefixed secret too", () => {
		const plainSecret = "shared-plain-secret-value";
		const headers = sign(payload, plainSecret);
		expect(verifyWebhookSignature(payload, headers, plainSecret)).toBe(true);
	});

	test("returns false for wrong secret", () => {
		const headers = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				headers,
				"whsec_d3Jvbmctc2VjcmV0LXZhbHVlLXRlc3RpbmctaGVscGVy",
			),
		).toBe(false);
	});

	test("returns false for tampered payload", () => {
		const headers = sign(payload, secret);
		expect(verifyWebhookSignature("tampered", headers, secret)).toBe(false);
	});

	test("returns false for expired signature", () => {
		const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
		const headers = sign(payload, secret, { timestampSeconds: oldTimestamp });
		expect(verifyWebhookSignature(payload, headers, secret, 300)).toBe(false);
	});

	test("returns false when webhook-id header missing", () => {
		const { "webhook-id": _id, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false when webhook-signature header missing", () => {
		const { "webhook-signature": _sig, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false when webhook-timestamp header missing", () => {
		const { "webhook-timestamp": _ts, ...rest } = sign(payload, secret);
		expect(verifyWebhookSignature(payload, rest, secret)).toBe(false);
	});

	test("returns false for malformed signature header", () => {
		const headers = sign(payload, secret);
		expect(
			verifyWebhookSignature(
				payload,
				{ ...headers, "webhook-signature": "garbage" },
				secret,
			),
		).toBe(false);
	});

	test("accepts multi-version signature header (v1,abc v2,def)", () => {
		const headers = sign(payload, secret);
		const multi = `${headers["webhook-signature"]} v2,unrelated-future-version`;
		expect(
			verifyWebhookSignature(
				payload,
				{ ...headers, "webhook-signature": multi },
				secret,
			),
		).toBe(true);
	});
});
