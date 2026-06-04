import { describe, expect, it } from "bun:test";
import { DECODED_EVENT_TYPES } from "@secondlayer/shared";
import { INDEX_EVENT_CONFIG } from "./events.ts";

// The Index event registry is the per-type filter vocabulary surfaced in
// GET /v1/index discovery; the shared DECODED_EVENT_TYPES list is what the SDK,
// CLI, and MCP advertise. If these diverge, discovery lies about what the
// endpoint accepts. Keep them in lockstep.
describe("Index event vocabulary", () => {
	it("registry keys match the shared decoded event-type list", () => {
		expect(Object.keys(INDEX_EVENT_CONFIG).sort()).toEqual(
			[...DECODED_EVENT_TYPES].sort(),
		);
	});
});
