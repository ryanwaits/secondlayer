import { describe, expect, it } from "bun:test";
import { DECODED_EVENT_TYPES, VM_EVENT_TYPES } from "@secondlayer/shared";
import { openapiSpec } from "../routes/openapi.ts";
import { INDEX_EVENT_CONFIG } from "./events.ts";
import { VM_INDEX_EVENT_CONFIG } from "./vm-events.ts";

// The Index event registry is the per-type filter vocabulary surfaced in
// GET /v1/index discovery; the shared DECODED_EVENT_TYPES list is what the SDK,
// CLI, and MCP advertise. If these diverge, discovery lies about what the
// endpoint accepts. Keep them in lockstep. VM types are a parallel vocab.
describe("Index event vocabulary", () => {
	it("registry keys match the shared decoded event-type list", () => {
		expect(Object.keys(INDEX_EVENT_CONFIG).sort()).toEqual(
			[...DECODED_EVENT_TYPES].sort(),
		);
	});

	it("vm registry keys match VM_EVENT_TYPES", () => {
		expect(Object.keys(VM_INDEX_EVENT_CONFIG).sort()).toEqual(
			[...VM_EVENT_TYPES].sort(),
		);
	});

	it("OpenAPI /v1/index/events declares every registry filter", () => {
		const spec = openapiSpec("oss") as {
			paths: {
				"/v1/index/events": {
					get: { parameters: Array<{ name?: string; $ref?: string }> };
				};
			};
		};
		const names = new Set(
			spec.paths["/v1/index/events"].get.parameters.map((p) => {
				if (p.name) return p.name;
				if (p.$ref?.endsWith("/Limit")) return "limit";
				if (p.$ref?.endsWith("/Cursor")) return "cursor";
				return p.$ref ?? "";
			}),
		);
		const registry = [
			...Object.values(INDEX_EVENT_CONFIG),
			...Object.values(VM_INDEX_EVENT_CONFIG),
		];
		for (const cfg of registry) {
			for (const filter of cfg.allowedFilters) {
				expect(names.has(filter), filter).toBe(true);
			}
		}
	});
});
