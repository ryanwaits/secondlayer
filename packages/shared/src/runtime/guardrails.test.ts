import { describe, expect, test } from "bun:test";
import { preflightResources } from "./guardrails.ts";

describe("resource guardrails", () => {
	test("constrained fixtures fail early", () => {
		const low = preflightResources(
			{ ramMb: 512, diskGb: 10, postgresMaxConnections: 10 },
			"external",
		);
		expect(low.ok).toBe(false);
		if (!low.ok) expect(low.errors.length).toBeGreaterThan(0);
	});

	test("a passing app-services box is accepted", () => {
		const ok = preflightResources(
			{ ramMb: 8192, diskGb: 120, postgresMaxConnections: 100 },
			"external",
		);
		expect(ok.ok).toBe(true);
		if (ok.ok) expect(ok.estimates.diskGbPer100kBlocks).toBe(1);
	});
});
