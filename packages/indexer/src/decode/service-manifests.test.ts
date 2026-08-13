import { describe, expect, test } from "bun:test";
import {
	buildDerivedStageReport,
	validateServiceManifests,
} from "@secondlayer/shared/archive/derived-stage-report";
import { DECODER_SERVICE_MANIFESTS } from "./service-manifests.ts";

/**
 * Guarantees the built-in decoder registry stays honest. If any of these
 * assertions fail, someone added or edited a manifest without keeping its
 * self-declared rebuild story consistent — the whole reason the schema
 * exists.
 */

describe("built-in decoder service manifests", () => {
	test("register at least one decoder", () => {
		expect(DECODER_SERVICE_MANIFESTS.length).toBeGreaterThan(0);
	});

	test("validate cleanly against the shared schema", () => {
		expect(validateServiceManifests(DECODER_SERVICE_MANIFESTS)).toEqual([]);
	});

	test("each decoder points at a source file inside the indexer package", () => {
		for (const m of DECODER_SERVICE_MANIFESTS) {
			expect(m.source_path.startsWith("packages/indexer/")).toBe(true);
		}
	});

	test("each decoder declares outputs — a silent decoder is a bug in the manifest", () => {
		for (const m of DECODER_SERVICE_MANIFESTS) {
			expect(m.outputs.length).toBeGreaterThan(0);
		}
	});

	test("report is byte-stable across runs", () => {
		const a = buildDerivedStageReport(
			DECODER_SERVICE_MANIFESTS,
			"2026-01-01T00:00:00.000Z",
		);
		const b = buildDerivedStageReport(
			DECODER_SERVICE_MANIFESTS,
			"2026-01-01T00:00:00.000Z",
		);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});
