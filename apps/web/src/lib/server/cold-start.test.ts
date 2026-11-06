import { describe, expect, test } from "bun:test";
import {
	claimHighlighterWarmup,
	coldStartLine,
	recordWarmup,
	recordWarmupFailure,
} from "./cold-start";

describe("coldStartLine", () => {
	test("reports every field once, then nothing for later requests", () => {
		recordWarmup("highlighterMs", performance.now() - 120);
		const refused = Object.assign(
			new TypeError("fetch failed: https://api.example/health?token=secret"),
			{ cause: { code: "ECONNREFUSED" } },
		);
		recordWarmupFailure("agentConnectMs", refused);
		const line = coldStartLine("/account", performance.now() - 30);
		expect(line).toMatch(
			/^cold-start route=\/account initMs=\d+ firstRequestMs=\d+ highlighterMs=\d+ agentConnectMs=failed:ECONNREFUSED$/,
		);
		expect(coldStartLine("/account", performance.now())).toBeNull();
	});
});

describe("claimHighlighterWarmup", () => {
	test("only the first caller warms the highlighter", () => {
		expect(claimHighlighterWarmup()).toBe(true);
		expect(claimHighlighterWarmup()).toBe(false);
	});
});
