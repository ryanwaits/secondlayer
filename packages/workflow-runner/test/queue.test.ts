import { describe, expect, test } from "bun:test";
import { classifyError } from "../src/queue.ts";

describe("classifyError", () => {
	test("unknown errors default to retryable", () => {
		expect(classifyError(new Error("boom")).retryable).toBe(true);
		expect(classifyError("string error").retryable).toBe(true);
		expect(classifyError(null).retryable).toBe(true);
	});

	test("respects isRetryable=true", () => {
		const err = Object.assign(new Error("rate limited"), {
			isRetryable: true,
			name: "RateLimitError",
		});
		const result = classifyError(err);
		expect(result.retryable).toBe(true);
		expect(result.reason).toContain("RateLimitError");
		expect(result.reason).toContain("retryable");
	});

	test("respects isRetryable=false", () => {
		const err = Object.assign(new Error("bad input"), {
			isRetryable: false,
			name: "ValidationError",
		});
		const result = classifyError(err);
		expect(result.retryable).toBe(false);
		expect(result.reason).toContain("ValidationError");
		expect(result.reason).toContain("non-retryable");
	});

	test("falls back when isRetryable is non-boolean", () => {
		const err = { isRetryable: "yes" };
		expect(classifyError(err).retryable).toBe(true);
	});
});
