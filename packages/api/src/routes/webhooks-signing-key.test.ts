import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateEd25519KeyPair } from "@secondlayer/shared/crypto/ed25519";
import {
	getSecondlayerWebhookSigner,
	resetSecondlayerWebhookSignerForTest,
} from "@secondlayer/shared/crypto/secondlayer-webhook";
import webhooks from "./webhooks.ts";

const ENV_KEYS = [
	"SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY",
	"STREAMS_SIGNING_PRIVATE_KEY",
	"TESTNET_WEBHOOK_STACK",
] as const;

describe("GET /api/webhooks/signing-key", () => {
	const saved = new Map<string, string | undefined>();

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved.set(key, process.env[key]);
			Reflect.deleteProperty(process.env, key);
		}
		resetSecondlayerWebhookSignerForTest();
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			const value = saved.get(key);
			if (value === undefined) Reflect.deleteProperty(process.env, key);
			else process.env[key] = value;
		}
		resetSecondlayerWebhookSignerForTest();
	});

	test("serves the key this stack signs deliveries with, not the Streams key", async () => {
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY =
			generateEd25519KeyPair().privateKeyPem;
		process.env.STREAMS_SIGNING_PRIVATE_KEY =
			generateEd25519KeyPair().privateKeyPem;
		const signer = getSecondlayerWebhookSigner();

		const res = await webhooks.request("/signing-key");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			algorithm: "ed25519",
			key_id: signer?.keyId,
			public_key_pem: signer?.publicKeyPem,
		});
	});

	test("says signing is off when the stack has no key", async () => {
		const res = await webhooks.request("/signing-key");
		expect(res.status).toBe(503);
	});

	test("the shared testnet stack refuses a request with no account", async () => {
		process.env.TESTNET_WEBHOOK_STACK = "true";
		const res = await webhooks.request("/signing-key");
		expect(res.status).toBe(401);
	});

	test("the shared testnet stack serves its key to an account", async () => {
		process.env.TESTNET_WEBHOOK_STACK = "true";
		process.env.SECONDLAYER_WEBHOOK_SIGNING_PRIVATE_KEY =
			generateEd25519KeyPair().privateKeyPem;
		const res = await webhooks.request("/signing-key", {
			headers: { "x-secondlayer-account-id": "acct-1" },
		});
		expect(res.status).toBe(200);
	});
});
