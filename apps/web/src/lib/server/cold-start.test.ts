import { describe, expect, test } from "bun:test";
import { coldStartLine, recordWarmup } from "./cold-start";

describe("coldStartLine", () => {
	test("reports every field once, then nothing for later requests", () => {
		recordWarmup("highlighterMs", performance.now() - 120);
		const line = coldStartLine("/account", performance.now() - 30);
		expect(line).toMatch(
			/^cold-start route=\/account initMs=\d+ firstRequestMs=\d+ highlighterMs=\d+ agentConnectMs=pending$/,
		);
		expect(coldStartLine("/account", performance.now())).toBeNull();
	});
});
