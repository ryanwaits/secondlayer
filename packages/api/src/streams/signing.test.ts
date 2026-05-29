import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ed25519 } from "@secondlayer/shared";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.ts";
import { createStreamsRouter } from "../routes/streams.ts";
import { STREAMS_READ_SCOPE, type StreamsTokenStore } from "./auth.ts";
import { getStreamsSigner, resetStreamsSignerForTest } from "./signing.ts";
import type { StreamsTip } from "./tip.ts";

const TIP: StreamsTip = {
	block_height: 200_000,
	block_hash: "0x01",
	burn_block_height: 20_000,
	finalized_height: 199_994,
	lag_seconds: 0,
};

const TOKENS: StreamsTokenStore = new Map([
	[
		"sk-sl_build",
		{ tenant_id: "t", tier: "build" as const, scopes: [STREAMS_READ_SCOPE] },
	],
]);

function app() {
	const a = new Hono();
	a.onError(errorHandler);
	a.route(
		"/v1/streams",
		createStreamsRouter({
			tokens: TOKENS,
			getTip: () => TIP,
			readEvents: async () => ({ events: [], next_cursor: null }),
			readReorgs: async () => [],
		}),
	);
	return a;
}

const auth = { Authorization: "Bearer sk-sl_build" };
const original = process.env.STREAMS_SIGNING_PRIVATE_KEY;

afterEach(() => {
	// Empty string reads as "unset" to getStreamsSigner (falsy), avoiding `delete`.
	process.env.STREAMS_SIGNING_PRIVATE_KEY = original ?? "";
	resetStreamsSignerForTest();
});

describe("Streams response signing", () => {
	test("no signature headers when signing is disabled", async () => {
		process.env.STREAMS_SIGNING_PRIVATE_KEY = "";
		resetStreamsSignerForTest();
		const res = await app().request("/v1/streams/events", { headers: auth });
		expect(res.status).toBe(200);
		expect(res.headers.get("X-Signature")).toBeNull();
		expect(getStreamsSigner()).toBeNull();
	});

	describe("with a signing key", () => {
		beforeEach(() => {
			const { privateKeyPem } = ed25519.generateEd25519KeyPair();
			process.env.STREAMS_SIGNING_PRIVATE_KEY = privateKeyPem;
			resetStreamsSignerForTest();
		});

		test("emits a verifiable X-Signature over the exact body", async () => {
			const res = await app().request("/v1/streams/events", { headers: auth });
			const body = await res.text();
			const signature = res.headers.get("X-Signature");
			const keyId = res.headers.get("X-Signature-KeyId");
			const signer = getStreamsSigner();
			expect(signer).not.toBeNull();
			expect(keyId).toBe(signer?.keyId ?? "");
			expect(signature).toBeTruthy();
			const pub = ed25519.loadEd25519PublicKey(signer?.publicKeyPem ?? "");
			expect(ed25519.verifyEd25519(body, signature as string, pub)).toBe(true);
			// A tampered body fails verification.
			expect(ed25519.verifyEd25519(`${body} `, signature as string, pub)).toBe(
				false,
			);
		});
	});
});
