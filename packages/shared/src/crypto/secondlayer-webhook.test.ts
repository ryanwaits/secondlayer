import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateEd25519KeyPair } from "./ed25519.ts";
import {
	assertWebhookSigningConfigured,
	getSecondlayerWebhookSigner,
	resetSecondlayerWebhookSignerForTest,
	signSecondlayerWebhook,
	verifySecondlayerSignatureValues,
} from "./secondlayer-webhook.ts";

const SIG_HEADER = "x-secondlayer-signature";
const ID_HEADER = "webhook-id";

describe("secondlayer webhook signing", () => {
	const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
	const savedWebhookKey = process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY;
	const savedStreamsKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;

	beforeEach(() => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = privateKeyPem;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = undefined;
		resetSecondlayerWebhookSignerForTest();
	});

	afterEach(() => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = savedWebhookKey;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = savedStreamsKey;
		resetSecondlayerWebhookSignerForTest();
	});

	test("sign → verify round-trips and carries the key id", () => {
		const body = '{"hello":"world"}';
		const headers = signSecondlayerWebhook("evt-1", body);
		expect(headers).not.toBeNull();
		if (!headers) throw new Error("unreachable");

		expect(headers[ID_HEADER]).toBe("evt-1");
		const signer = getSecondlayerWebhookSigner();
		expect(signer).not.toBeNull();
		expect(headers["x-secondlayer-signature-keyid"]).toBe(signer?.keyId ?? "");
		expect(
			verifySecondlayerSignatureValues(
				body,
				headers[ID_HEADER],
				headers[SIG_HEADER],
				publicKeyPem,
			),
		).toBe(true);
	});

	test("a tampered body fails verification", () => {
		const headers = signSecondlayerWebhook("evt-2", '{"amount":"100"}');
		if (!headers) throw new Error("unreachable");
		expect(
			verifySecondlayerSignatureValues(
				'{"amount":"999"}',
				headers[ID_HEADER],
				headers[SIG_HEADER],
				publicKeyPem,
			),
		).toBe(false);
	});

	test("a mismatched id fails verification (id is bound into the signature)", () => {
		const body = '{"a":1}';
		const headers = signSecondlayerWebhook("evt-3", body);
		if (!headers) throw new Error("unreachable");
		expect(
			verifySecondlayerSignatureValues(
				body,
				"evt-OTHER",
				headers[SIG_HEADER],
				publicKeyPem,
			),
		).toBe(false);
	});

	test("missing signature or id verifies false", () => {
		expect(
			verifySecondlayerSignatureValues("body", undefined, "sig", publicKeyPem),
		).toBe(false);
		expect(
			verifySecondlayerSignatureValues("body", "evt", undefined, publicKeyPem),
		).toBe(false);
	});

	test("falls back to the streams key when no dedicated webhook key is set", () => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = undefined;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = privateKeyPem;
		resetSecondlayerWebhookSignerForTest();
		expect(getSecondlayerWebhookSigner()).not.toBeNull();
	});

	test("returns null (unsigned) when no key is configured", () => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = undefined;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = undefined;
		resetSecondlayerWebhookSignerForTest();
		expect(getSecondlayerWebhookSigner()).toBeNull();
		expect(signSecondlayerWebhook("evt", "body")).toBeNull();
	});
});

describe("assertWebhookSigningConfigured (boot guard)", () => {
	const { privateKeyPem } = generateEd25519KeyPair();
	const savedWebhookKey = process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY;
	const savedStreamsKey = process.env.STREAMS_SIGNING_PRIVATE_KEY;
	const savedNodeEnv = process.env.NODE_ENV;
	const savedAllow = process.env.ALLOW_UNSIGNED_WEBHOOKS;

	beforeEach(() => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = undefined;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = undefined;
		process.env.ALLOW_UNSIGNED_WEBHOOKS = undefined;
		resetSecondlayerWebhookSignerForTest();
	});

	afterEach(() => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY = savedWebhookKey;
		process.env.STREAMS_SIGNING_PRIVATE_KEY = savedStreamsKey;
		process.env.NODE_ENV = savedNodeEnv;
		process.env.ALLOW_UNSIGNED_WEBHOOKS = savedAllow;
		resetSecondlayerWebhookSignerForTest();
	});

	test("prod + no key + no opt-out → throws (refuses to boot)", () => {
		process.env.NODE_ENV = "production";
		expect(() => assertWebhookSigningConfigured()).toThrow(/UNSIGNED/);
	});

	test("prod + opt-out → does not throw", () => {
		process.env.NODE_ENV = "production";
		process.env.ALLOW_UNSIGNED_WEBHOOKS = "true";
		expect(() => assertWebhookSigningConfigured()).not.toThrow();
	});

	test("non-prod + no key → warns, does not throw", () => {
		process.env.NODE_ENV = "development";
		expect(() => assertWebhookSigningConfigured()).not.toThrow();
	});

	test("key set → does not throw even in prod", () => {
		process.env.NODE_ENV = "production";
		process.env.STREAMS_SIGNING_PRIVATE_KEY = privateKeyPem;
		resetSecondlayerWebhookSignerForTest();
		expect(() => assertWebhookSigningConfigured()).not.toThrow();
	});
});
