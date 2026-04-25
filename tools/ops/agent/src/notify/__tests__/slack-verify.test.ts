import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "../slack-verify.ts";

const SECRET = "test_signing_secret_12345";

function makeSignature(
	secret: string,
	timestamp: string,
	body: string,
): string {
	return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

function nowTimestamp(): string {
	return String(Math.floor(Date.now() / 1000));
}

describe("verifySlackSignature", () => {
	test("valid signature passes", () => {
		const ts = nowTimestamp();
		const body = "payload=%7B%22test%22%3Atrue%7D";
		const sig = makeSignature(SECRET, ts, body);

		expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(true);
	});

	test("wrong secret fails", () => {
		const ts = nowTimestamp();
		const body = "payload=%7B%22test%22%3Atrue%7D";
		const sig = makeSignature("wrong_secret", ts, body);

		expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(false);
	});

	test("tampered body fails", () => {
		const ts = nowTimestamp();
		const body = "payload=%7B%22test%22%3Atrue%7D";
		const sig = makeSignature(SECRET, ts, body);

		expect(verifySlackSignature(SECRET, sig, ts, "payload=tampered")).toBe(
			false,
		);
	});

	test("replay attack (>5min old) fails", () => {
		const ts = String(Math.floor(Date.now() / 1000) - 400); // 6+ min old
		const body = "payload=%7B%22test%22%3Atrue%7D";
		const sig = makeSignature(SECRET, ts, body);

		expect(verifySlackSignature(SECRET, sig, ts, body)).toBe(false);
	});

	test("empty signing secret fails", () => {
		const ts = nowTimestamp();
		const body = "test";
		expect(verifySlackSignature("", "v0=abc", ts, body)).toBe(false);
	});

	test("missing signature fails", () => {
		const ts = nowTimestamp();
		expect(verifySlackSignature(SECRET, "", ts, "test")).toBe(false);
	});
});
