import { describe, expect, test } from "bun:test";
import { outputTone } from "./output";

describe("outputTone", () => {
	test("warning, cross and error lines are alarms", () => {
		expect(outputTone("⚠ 1 of 175 ranges diverge")).toBe("err");
		expect(outputTone("  ✗ blocks failed")).toBe("err");
		expect(outputTone("error: no such dataset")).toBe("err");
		expect(outputTone("Error: no such dataset")).toBe("err");
	});

	test("a word that only starts with error is ordinary output", () => {
		expect(outputTone("errors: none")).toBe("out");
		expect(outputTone("errorless run")).toBe("out");
	});

	test("check marks are ok", () => {
		expect(outputTone("✓ 174 ranges match")).toBe("ok");
	});

	test("all-caps header rows fade", () => {
		expect(outputTone("DATASET STATUS")).toBe("head");
		expect(outputTone("  NAME")).toBe("head");
	});

	test("table rows, short or mixed-case text and blank lines are plain output", () => {
		expect(outputTone("RANGE   DATASET  STATUS 12")).toBe("out");
		expect(outputTone("OK")).toBe("out");
		expect(outputTone("Dataset status")).toBe("out");
		expect(outputTone("")).toBe("out");
	});
});
