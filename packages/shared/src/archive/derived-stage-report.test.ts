import { describe, expect, test } from "bun:test";
import {
	type ServiceManifest,
	buildDerivedStageReport,
	validateServiceManifests,
} from "./derived-stage-report.ts";

const sbtc: ServiceManifest = {
	name: "decode:sbtc",
	kind: "decoder",
	description: "sBTC deposit/withdrawal event decoder",
	canonical_inputs: ["blocks", "transactions", "events"],
	external_inputs: [
		{
			name: "contract-source-registry",
			reason:
				"decoder resolves function signatures against the sBTC contract ABI, which lives outside the transactions table",
			source: "bundled-registry",
			rebuildable_from_archive: false,
		},
	],
	outputs: [
		{ target: "sbtc_events", verification: "semantic-digest" },
		{ target: "sbtc_deposits", verification: "row-count" },
	],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/sbtc.ts",
};

const bnsBad: ServiceManifest = {
	name: "decode:bns",
	kind: "decoder",
	description: "BNS event decoder",
	canonical_inputs: ["blocks", "transactions", "events"],
	external_inputs: [],
	outputs: [{ target: "bns_names", verification: "semantic-digest" }],
	r2_alone_can_rebuild: false,
	requires_operator_state: false,
	source_path: "packages/indexer/src/decode/decoders/bns.ts",
};

describe("buildDerivedStageReport", () => {
	test("sorts services by name for byte-stable output", () => {
		const report = buildDerivedStageReport(
			[sbtc, { ...sbtc, name: "decode:aaa" }],
			"2026-01-01T00:00:00.000Z",
		);
		expect(report.services.map((s) => s.name)).toEqual([
			"decode:aaa",
			"decode:sbtc",
		]);
		expect(report.schema_version).toBe(1);
	});

	test("empty registry produces an empty services list, not omission", () => {
		const report = buildDerivedStageReport([], "2026-01-01T00:00:00.000Z");
		expect(report.services).toEqual([]);
	});
});

describe("validateServiceManifests", () => {
	test("passes a well-formed manifest", () => {
		expect(validateServiceManifests([sbtc])).toEqual([]);
	});

	test("catches an unrebuildable service with no declared external inputs", () => {
		const issues = validateServiceManifests([bnsBad]);
		expect(issues).toHaveLength(1);
		expect(issues[0]?.name).toBe("decode:bns");
		expect(issues[0]?.problem).toMatch(/gap is undocumented/);
	});

	test("catches duplicate service names", () => {
		const issues = validateServiceManifests([sbtc, sbtc]);
		expect(issues.some((i) => i.problem === "duplicate service name")).toBe(
			true,
		);
	});

	test("catches unknown canonical_inputs", () => {
		const bogus = {
			...sbtc,
			canonical_inputs: ["blocks", "not-a-dataset"] as unknown as Array<
				"blocks" | "transactions" | "events"
			>,
		};
		const issues = validateServiceManifests([bogus]);
		expect(issues.some((i) => i.problem.includes("not-a-dataset"))).toBe(true);
	});
});
