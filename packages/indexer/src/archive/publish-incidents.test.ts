import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type IncidentReport,
	buildIndex,
	loadReports,
	validateReport,
} from "./publish-incidents.ts";

/**
 * Incident reports are evidence, so the checks here are about whether a
 * published report can be trusted to be complete and enumerable — not about
 * formatting.
 */

function report(overrides: Partial<IncidentReport> = {}): IncidentReport {
	return {
		schema_version: 1,
		id: "2026-08-12-example",
		date: "2026-08-12",
		title: "Example",
		severity: "P3",
		affects_archive: true,
		summary: "Something went wrong.",
		root_cause: "A mistake.",
		...overrides,
	};
}

describe("report validation", () => {
	test("accepts a complete report", () => {
		expect(() => validateReport(report(), "f.json")).not.toThrow();
	});

	test("rejects a report with no root cause", () => {
		// Without one this is a notification, not an incident report — and the
		// root cause is the part that is uncomfortable to write.
		const { root_cause: _omitted, ...rest } = report();
		expect(() => validateReport(rest as IncidentReport, "f.json")).toThrow(
			/root_cause/,
		);
	});

	test("rejects a malformed date", () => {
		expect(() =>
			validateReport(report({ date: "Aug 12 2026" }), "f.json"),
		).toThrow(/YYYY-MM-DD/);
	});

	test("requires the id to start with its date", () => {
		// The index sorts by id alone, so a divergent id would silently misorder
		// the timeline.
		expect(() =>
			validateReport(report({ id: "fork-points" }), "f.json"),
		).toThrow(/must start with its date/);
	});
});

describe("index", () => {
	test("lists newest first", () => {
		const index = buildIndex(
			[
				report({ id: "2026-01-01-old", date: "2026-01-01" }),
				report({ id: "2026-08-12-new", date: "2026-08-12" }),
			],
			"2026-08-12T00:00:00.000Z",
		);
		expect(index.incidents.map((i) => i.id)).toEqual([
			"2026-08-12-new",
			"2026-01-01-old",
		]);
	});

	test("carries whether each incident touched the archive", () => {
		// A consumer deciding whether to re-verify cares about this flag more
		// than the prose.
		const index = buildIndex(
			[report({ affects_archive: false })],
			"2026-08-12T00:00:00.000Z",
		);
		expect(index.incidents[0]?.affects_archive).toBe(false);
	});

	test("paths resolve under the archive root", () => {
		const index = buildIndex([report()], "2026-08-12T00:00:00.000Z");
		expect(index.incidents[0]?.path).toBe(
			"reports/incidents/2026-08-12-example.json",
		);
	});
});

describe("loading", () => {
	test("a malformed report fails the whole publish rather than being skipped", async () => {
		// Silently dropping an unpublishable incident is the failure mode this
		// exists to prevent.
		const dir = await mkdtemp(join(tmpdir(), "incidents-"));
		try {
			await writeFile(
				join(dir, "good.json"),
				JSON.stringify(report({ id: "2026-08-12-good" })),
			);
			await writeFile(
				join(dir, "bad.json"),
				JSON.stringify({ id: "2026-08-12-bad", date: "2026-08-12" }),
			);
			expect(loadReports(dir)).rejects.toThrow(/missing required field/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("loads the real published reports", async () => {
		// Guards the actual files we ship, not a fixture. Resolved from this
		// file, not the CWD — package test runners set CWD to the package dir.
		const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
		const reports = await loadReports(
			join(repoRoot, "docs", "incidents", "published"),
		);
		expect(reports.length).toBeGreaterThanOrEqual(2);
		for (const r of reports) {
			expect(r.root_cause).toBeTruthy();
			expect(r.summary.length).toBeGreaterThan(40);
		}
	});
});
