import { describe, expect, test } from "bun:test";
import {
	needsCompactWrite,
	parseCompact,
	serializeCompact,
} from "./compact-view";

describe("compact view cookie", () => {
	test("round-trips both layouts", () => {
		expect(parseCompact(serializeCompact(true))).toBe(true);
		expect(parseCompact(serializeCompact(false))).toBe(false);
	});

	test("anything malformed is null, so the desktop default applies", () => {
		expect(parseCompact(undefined)).toBeNull();
		expect(parseCompact(null)).toBeNull();
		expect(parseCompact("")).toBeNull();
		expect(parseCompact("true")).toBeNull();
		expect(parseCompact("2")).toBeNull();
	});

	test("writes only when the saved layout differs from the viewport", () => {
		expect(needsCompactWrite(null, false)).toBe(true);
		expect(needsCompactWrite(null, true)).toBe(true);
		expect(needsCompactWrite(true, false)).toBe(true);
		expect(needsCompactWrite(true, true)).toBe(false);
		expect(needsCompactWrite(false, false)).toBe(false);
	});
});
