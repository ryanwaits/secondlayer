import { describe, expect, test } from "bun:test";
import { createSignatureHeader } from "@secondlayer/shared/crypto/hmac";
import { verifyWebhookSignature } from "../webhooks.ts";

describe("verifyWebhookSignature", () => {
	const secret = "test-secret-hex-value";
	const payload = JSON.stringify({ streamId: "abc", block: { height: 100 } });

	test("returns true for valid signature", () => {
		const header = createSignatureHeader(payload, secret);
		expect(verifyWebhookSignature(payload, header, secret)).toBe(true);
	});

	test("returns false for wrong secret", () => {
		const header = createSignatureHeader(payload, secret);
		expect(verifyWebhookSignature(payload, header, "wrong-secret")).toBe(false);
	});

	test("returns false for tampered payload", () => {
		const header = createSignatureHeader(payload, secret);
		expect(verifyWebhookSignature("tampered", header, secret)).toBe(false);
	});

	test("returns false for expired signature", () => {
		const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
		const header = createSignatureHeader(payload, secret, oldTimestamp);
		expect(verifyWebhookSignature(payload, header, secret, 300)).toBe(false);
	});

	test("returns false for malformed header", () => {
		expect(verifyWebhookSignature(payload, "garbage", secret)).toBe(false);
	});
});
