import { describe, expect, test } from "bun:test";
import { ApiError, assertSafePath } from "./api";

describe("assertSafePath", () => {
	test("plain instance paths pass", () => {
		expect(() => assertSafePath("/v1/instance")).not.toThrow();
		expect(() => assertSafePath("/api/subgraphs/sbtc/deposits")).not.toThrow();
		expect(() =>
			assertSafePath("/api/subgraphs/sbtc/deposits?_limit=10&_offset=0"),
		).not.toThrow();
	});

	test("dot and dot-dot segments are rejected, encoded or not", () => {
		for (const p of [
			"/api/subgraphs/../keys",
			"/api/subgraphs/%2e%2e/keys",
			"/api/subgraphs/./x",
			"/api/subgraphs/%2e/x",
		]) {
			expect(() => assertSafePath(p)).toThrow(ApiError);
		}
	});

	test("a segment smuggling an encoded slash is rejected", () => {
		expect(() => assertSafePath("/api/subgraphs/a%2fb")).toThrow(ApiError);
	});

	test("an undecodable segment is rejected, not crashed on", () => {
		expect(() => assertSafePath("/api/subgraphs/%zz")).toThrow(ApiError);
	});

	test("query strings do not shield the path check", () => {
		expect(() => assertSafePath("/api/../secrets?x=/api/subgraphs")).toThrow(
			ApiError,
		);
	});
});
