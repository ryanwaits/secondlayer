import { describe, expect, test } from "bun:test";
import { resultForStatus, resultFromResponse } from "./dashboard-results";

describe("resultForStatus", () => {
	test("a 2xx maps to null (caller reads the body)", () => {
		expect(resultForStatus(200, null, "")).toBeNull();
		expect(resultForStatus(201, null, "")).toBeNull();
	});
	test("503 → starting, with Retry-After parsed or defaulted to 30", () => {
		expect(resultForStatus(503, "45", "")).toEqual({
			kind: "starting",
			retryAfter: 45,
		});
		expect(resultForStatus(503, null, "")).toEqual({
			kind: "starting",
			retryAfter: 30,
		});
	});
	test("503 asleep → asleep, never a starting retry loop", () => {
		expect(resultForStatus(503, null, "asleep")).toEqual({ kind: "asleep" });
	});
	test("402 → no_credits", () => {
		expect(resultForStatus(402, null, "")).toEqual({ kind: "no_credits" });
	});
	test("429 → rate_limited, with Retry-After parsed", () => {
		expect(resultForStatus(429, "12", "")).toEqual({
			kind: "rate_limited",
			retryAfter: 12,
		});
	});
	test("404 → not_found", () => {
		expect(resultForStatus(404, null, "")).toEqual({ kind: "not_found" });
	});
	test("anything else → error, carrying the given message", () => {
		expect(resultForStatus(500, null, "boom")).toEqual({
			kind: "error",
			message: "boom",
		});
		expect(resultForStatus(401, null, "Sign in first")).toEqual({
			kind: "error",
			message: "Sign in first",
		});
	});
});

describe("resultFromResponse", () => {
	const res = (status: number, headers?: Record<string, string>) =>
		new Response(null, { status, headers });

	test("a 2xx carries the body as data", () => {
		expect(resultFromResponse(res(200), { a: 1 })).toEqual({
			kind: "ok",
			data: { a: 1 },
		});
	});
	test("503 with an asleep error is asleep, not starting", () => {
		expect(resultFromResponse(res(503), { error: "asleep" })).toEqual({
			kind: "asleep",
		});
	});
	test("503 reads Retry-After for starting", () => {
		expect(
			resultFromResponse(res(503, { "Retry-After": "7" }), {
				error: "starting",
			}),
		).toEqual({ kind: "starting", retryAfter: 7 });
	});
	test("an error without a body names the status", () => {
		expect(resultFromResponse(res(500), null)).toEqual({
			kind: "error",
			message: "Request failed (500)",
		});
	});
});
