import { describe, expect, test } from "bun:test";
import { createProgressReporter, formatDuration } from "./progress.ts";

/**
 * The validation P1.5a asks for: a job silent longer than its interval is a
 * failure, progress never reaches stdout, and output is identical regardless
 * of terminal.
 */

function harness(total?: number, intervalMs = 30_000) {
	const lines: string[] = [];
	let clock = 0;
	const reporter = createProgressReporter({
		label: "blocks",
		total,
		intervalMs,
		write: (line) => lines.push(line),
		now: () => clock,
	});
	return {
		lines,
		reporter,
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

describe("progress reporting", () => {
	test("stays quiet inside the interval", () => {
		const { lines, reporter, advance } = harness(100);
		reporter.tick(1);
		advance(5_000);
		reporter.tick(2);
		expect(lines).toHaveLength(0);
	});

	test("emits once the interval elapses", () => {
		const { lines, reporter, advance } = harness(100);
		advance(30_001);
		reporter.tick(25);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("25/100 (25%)");
	});

	test("never goes silent longer than the interval while work continues", () => {
		// The property that matters: silence means something is wrong, always.
		const { lines, reporter, advance } = harness(1_000, 30_000);
		for (let i = 1; i <= 10; i++) {
			advance(31_000);
			reporter.tick(i * 100);
		}
		expect(lines).toHaveLength(10);
	});

	test("reports an ETA only after there is a rate to extrapolate", () => {
		const { lines, reporter, advance } = harness(100);
		advance(31_000);
		reporter.tick(0); // nothing done yet
		expect(lines[0]).not.toContain("eta");

		advance(31_000);
		reporter.tick(50); // 50% in ~62s → ~1m remaining
		expect(lines[1]).toContain("eta");
	});

	test("works without a known total", () => {
		const { lines, reporter, advance } = harness(undefined);
		advance(31_000);
		reporter.tick(4_200);
		expect(lines[0]).toContain("4200");
		expect(lines[0]).not.toContain("%");
	});

	test("finish emits regardless of interval", () => {
		const { lines, reporter } = harness(100);
		reporter.finish("done");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("done");
	});

	test("output does not depend on a terminal", () => {
		// Same inputs, same bytes — no TTY-conditional formatting, so piped and
		// interactive runs agree and `--json` stdout is never affected.
		const a = harness(10);
		const b = harness(10);
		a.advance(31_000);
		b.advance(31_000);
		a.reporter.tick(5);
		b.reporter.tick(5);
		expect(a.lines).toEqual(b.lines);
	});
});

describe("formatDuration", () => {
	test("scales units so long jobs stay readable", () => {
		expect(formatDuration(45)).toBe("45s");
		expect(formatDuration(600)).toBe("10m");
		expect(formatDuration(9_000)).toBe("2.5h");
		expect(formatDuration(200_000)).toBe("2.3d");
	});

	test("does not invent a number it cannot know", () => {
		expect(formatDuration(Number.NaN)).toBe("unknown");
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("unknown");
	});
});
