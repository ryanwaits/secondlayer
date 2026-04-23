import { describe, expect, it } from "bun:test";
import { sign, verify } from "./standard-webhooks.ts";

// Reference vector from the Svix libraries' test suite. Reproducible with
// https://github.com/standard-webhooks/standard-webhooks/tree/main/libraries
const REF = {
	id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
	timestampSeconds: 1614265330,
	body: '{"test": 2432232314}',
	secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
	expectedSignature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("standard-webhooks", () => {
	it("matches Svix reference vector", () => {
		const headers = sign(REF.body, REF.secret, {
			id: REF.id,
			timestampSeconds: REF.timestampSeconds,
		});
		expect(headers["webhook-id"]).toBe(REF.id);
		expect(headers["webhook-timestamp"]).toBe(String(REF.timestampSeconds));
		expect(headers["webhook-signature"]).toBe(REF.expectedSignature);
	});

	it("verifies a freshly signed payload", () => {
		const body = '{"hello":"world"}';
		const secret = "whsec_dGVzdC1zZWNyZXQtMTIzNDU2Nzg5MA==";
		const headers = sign(body, secret);
		expect(verify(body, headers, secret)).toBe(true);
	});

	it("rejects tampered body", () => {
		const secret = "whsec_dGVzdA==";
		const headers = sign('{"a":1}', secret);
		expect(verify('{"a":2}', headers, secret)).toBe(false);
	});

	it("rejects skewed timestamp beyond tolerance", () => {
		const secret = "whsec_dGVzdA==";
		const now = 1_700_000_000;
		const headers = sign("x", secret, { timestampSeconds: now - 3600 });
		expect(verify("x", headers, secret, { nowSeconds: now })).toBe(false);
	});

	it("accepts utf8 secret (no whsec_ prefix)", () => {
		const body = "hello";
		const secret = "raw-utf8-secret";
		const headers = sign(body, secret);
		expect(verify(body, headers, secret)).toBe(true);
	});

	it("rejects when webhook-signature header missing", () => {
		const secret = "whsec_dGVzdA==";
		expect(
			verify(
				"x",
				{ "webhook-id": "abc", "webhook-timestamp": "1700000000" },
				secret,
			),
		).toBe(false);
	});
});
