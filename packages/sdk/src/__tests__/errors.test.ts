import { describe, expect, test } from "bun:test";
import {
	ApiError,
	AuthError,
	RateLimitError,
	SecondLayerError,
	ValidationError,
	parseRetryAfter,
} from "../errors.ts";
import {
	StreamsServerError,
	StreamsSignatureError,
} from "../streams/errors.ts";

describe("one error family", () => {
	test("re-parented classes keep identity AND join the ApiError family", () => {
		// The acceptance test from the re-parenting: existing `instanceof
		// RateLimitError` catches keep working, and `instanceof ApiError`
		// around an Index call is no longer dead code.
		const rate = new RateLimitError();
		expect(rate).toBeInstanceOf(RateLimitError);
		expect(rate).toBeInstanceOf(ApiError);
		expect(rate).toBeInstanceOf(SecondLayerError);
		expect(rate.status).toBe(429);
		expect(rate.retryable).toBe(true);

		const auth = new AuthError();
		expect(auth).toBeInstanceOf(AuthError);
		expect(auth).toBeInstanceOf(ApiError);
		expect(auth.status).toBe(401);
		expect(auth.retryable).toBe(false);

		const validation = new ValidationError("bad cursor", 400);
		expect(validation).toBeInstanceOf(ApiError);
		expect(validation.status).toBe(400);
		expect(validation.retryable).toBe(false);

		const server = new StreamsServerError("boom", 503);
		expect(server).toBeInstanceOf(ApiError);
		expect(server.retryable).toBe(true);

		expect(new StreamsSignatureError()).toBeInstanceOf(SecondLayerError);
	});

	test("retryability follows the status by default", () => {
		expect(new ApiError(500, "x").retryable).toBe(true);
		expect(new ApiError(429, "x").retryable).toBe(true);
		expect(new ApiError(404, "x").retryable).toBe(false);
		expect(new ApiError(422, "x").retryable).toBe(false);
		// Explicit override wins (network vs serialization, both status 0).
		expect(
			new ApiError(0, "x", undefined, undefined, { retryable: true }).retryable,
		).toBe(true);
		expect(
			new ApiError(0, "x", undefined, undefined, { retryable: false })
				.retryable,
		).toBe(false);
	});

	test("RateLimitError parses Retry-After into retryAfterSeconds", () => {
		expect(new RateLimitError("x", "30").retryAfterSeconds).toBe(30);
		expect(new RateLimitError("x").retryAfterSeconds).toBeUndefined();
		// HTTP-date form parses to a non-negative delta.
		const date = new Date(Date.now() + 5000).toUTCString();
		const parsed = new RateLimitError("x", date).retryAfterSeconds;
		expect(parsed).toBeGreaterThanOrEqual(0);
		expect(parsed).toBeLessThanOrEqual(6);
		expect(parseRetryAfter("garbage")).toBeUndefined();
	});

	test("walk() traverses the cause chain", () => {
		const root = new TypeError("socket closed");
		const err = new ApiError(0, "Cannot reach API", undefined, undefined, {
			retryable: true,
			cause: root,
		});
		expect(err.walk((e) => e instanceof TypeError)).toBe(root);
		expect(err.walk()).toBe(root);
		expect(err.walk((e) => e instanceof RangeError)).toBeNull();
	});

	test("docsUrl lands on operational errors and in the message", () => {
		const upgrade = new ApiError(
			402,
			"below the free window",
			undefined,
			"UPGRADE_REQUIRED",
		);
		expect(upgrade.docsUrl).toContain("/docs/authentication");
		expect(upgrade.message).toContain("Docs: ");
		expect(upgrade.shortMessage).toBe("below the free window");
	});

	test("toJSON serializes the whole protocol", () => {
		const err = new RateLimitError("Rate limited.", "12");
		expect(err.toJSON()).toMatchObject({
			name: "RateLimitError",
			shortMessage: "Rate limited.",
			retryable: true,
			retryAfterSeconds: 12,
		});
	});
});
