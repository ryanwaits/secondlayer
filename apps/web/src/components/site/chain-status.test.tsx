import { describe, expect, test } from "bun:test";
import { showsChainStatus } from "./chain-status";

describe("showsChainStatus", () => {
	test("marketing pages show the pill", () => {
		for (const path of ["/", "/pricing", "/verify", "/p/index", "/p/streams"])
			expect(showsChainStatus(path)).toBe(true);
	});

	test("docs, blog and account pages don't", () => {
		for (const path of [
			"/docs",
			"/docs/guides/print-events",
			"/blog",
			"/account",
		])
			expect(showsChainStatus(path)).toBe(false);
	});
});
