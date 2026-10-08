import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CODE_BY_STATUS,
	REQUEST_ID_PATTERN,
	augmentErrorBody,
	newRequestId,
	redactQuery,
} from "./error-envelope.ts";

const base = { requestId: "req_abc12345", feedbackUrl: "/v1/feedback" };

describe("newRequestId", () => {
	test("is req_ plus 24 lowercase hex and matches the reuse pattern", () => {
		const id = newRequestId();
		expect(id).toMatch(/^req_[0-9a-f]{24}$/);
		expect(REQUEST_ID_PATTERN.test(id)).toBe(true);
		expect(newRequestId()).not.toBe(id);
	});
	test("pattern rejects short and unsafe ids", () => {
		expect(REQUEST_ID_PATTERN.test("short")).toBe(false);
		expect(REQUEST_ID_PATTERN.test("<script>")).toBe(false);
	});
});

describe("redactQuery", () => {
	test("drops sensitive keys and keeps the rest", () => {
		const q = redactQuery(new URLSearchParams("token=abc&limit=5&apiKey=x"));
		expect(q).toEqual({ limit: "5" });
	});
	test("truncates long values to 200 chars", () => {
		const q = redactQuery(new URLSearchParams({ a: "x".repeat(500) }));
		expect((q.a as string).length).toBe(200);
	});
	test("over 2048 chars collapses to a key list", () => {
		const p = new URLSearchParams();
		for (let i = 0; i < 20; i++) p.set(`k${i}`, "v".repeat(200));
		const q = redactQuery(p);
		expect(q._truncated).toBe(true);
		expect((q.keys as string[]).length).toBe(20);
	});
});

describe("augmentErrorBody", () => {
	test("adds request_id, derived code and feedback", () => {
		expect(augmentErrorBody({ error: "x" }, { status: 409, ...base })).toEqual({
			error: "x",
			request_id: "req_abc12345",
			code: "CONFLICT",
			feedback: { url: "/v1/feedback" },
		});
	});
	test("preserves existing code, details and feedback; overrides request_id", () => {
		const out = augmentErrorBody(
			{
				error: "x",
				code: "TABLE_NOT_FOUND",
				details: { t: 1 },
				feedback: { url: "mine" },
				request_id: "stale",
			},
			{ status: 404, ...base },
		);
		expect(out).toEqual({
			error: "x",
			code: "TABLE_NOT_FOUND",
			details: { t: 1 },
			feedback: { url: "mine" },
			request_id: "req_abc12345",
		});
	});
	test("overrideFeedback replaces an existing pointer", () => {
		const out = augmentErrorBody(
			{ error: "x", feedback: { url: "old" } },
			{ status: 500, ...base, overrideFeedback: true },
		);
		expect(out?.feedback).toEqual({ url: "/v1/feedback" });
	});
	test("non-string code is replaced; unknown status is HTTP_ERROR", () => {
		expect(
			augmentErrorBody({ error: "x", code: 5 }, { status: 418, ...base })?.code,
		).toBe("HTTP_ERROR");
	});
	test("returns null for arrays, primitives and bodies without error", () => {
		const o = { status: 400, ...base };
		expect(augmentErrorBody([{ error: "x" }], o)).toBeNull();
		expect(augmentErrorBody("x", o)).toBeNull();
		expect(augmentErrorBody(null, o)).toBeNull();
		expect(augmentErrorBody({ ok: false }, o)).toBeNull();
	});
	test("status map covers the documented codes", () => {
		expect(DEFAULT_CODE_BY_STATUS[422]).toBe("VALIDATION_ERROR");
		expect(DEFAULT_CODE_BY_STATUS[503]).toBe("SERVICE_UNAVAILABLE");
	});
});
