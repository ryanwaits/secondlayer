import { describe, expect, test } from "bun:test";
import { createEpoch } from "./epoch";

describe("createEpoch", () => {
	test("a mark taken before a bump is no longer live", () => {
		const epoch = createEpoch();
		const live = epoch.mark();
		expect(live()).toBe(true);
		epoch.bump();
		expect(live()).toBe(false);
		expect(epoch.mark()()).toBe(true);
	});
});
