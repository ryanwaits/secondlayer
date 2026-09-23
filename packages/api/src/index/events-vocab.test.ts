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

	/** `/v1/index/events` params as the public spec declares them. */
	function specParams(): Map<string, { description?: string }> {
		const spec = openapiSpec("oss") as {
			paths: {
				"/v1/index/events": {
					get: {
						parameters: Array<{
							name?: string;
							$ref?: string;
							description?: string;
						}>;
					};
				};
			};
		};
		return new Map(
			spec.paths["/v1/index/events"].get.parameters.map((p) => {
				if (p.name) return [p.name, p];
				if (p.$ref?.endsWith("/Limit")) return ["limit", p];
				if (p.$ref?.endsWith("/Cursor")) return ["cursor", p];
				return [p.$ref ?? "", p];
			}),
		);
	}

	it("OpenAPI /v1/index/events declares every released event type's filters", () => {
		const names = specParams();
		for (const cfg of Object.values(INDEX_EVENT_CONFIG)) {
			for (const filter of cfg.allowedFilters) {
				expect(names.has(filter), filter).toBe(true);
			}
		}
	});

	// VM event types need an unreleased stacks-core node. Their filters are
	// accepted by the route but stay out of the public reference until it ships.
	it("OpenAPI /v1/index/events keeps VM-only filters out of the public reference", () => {
		const names = specParams();
		const released = new Set(
			Object.values(INDEX_EVENT_CONFIG).flatMap(
				(cfg) => cfg.allowedFilters as readonly string[],
			),
		);
		for (const cfg of Object.values(VM_INDEX_EVENT_CONFIG)) {
			for (const filter of cfg.allowedFilters) {
				if (released.has(filter)) continue;
				expect(names.has(filter), filter).toBe(false);
			}
		}
	});

	it("tx_id is a VM-only filter in the registry", () => {
		for (const [type, cfg] of Object.entries(INDEX_EVENT_CONFIG)) {
			expect(
				(cfg.allowedFilters as readonly string[]).includes("tx_id"),
				type,
			).toBe(false);
		}
		for (const [type, cfg] of Object.entries(VM_INDEX_EVENT_CONFIG)) {
			expect(
				(cfg.allowedFilters as readonly string[]).includes("tx_id"),
				type,
			).toBe(true);
		}
	});
});
