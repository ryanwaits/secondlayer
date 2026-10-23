import { describe, expect, test } from "bun:test";
import { dragAxis, settleSheet } from "./gesture";

describe("dragAxis", () => {
	test("movement under the slop is undecided", () => {
		expect(dragAxis(3, 2)).toBeNull();
	});
	test("mostly horizontal commits to x", () => {
		expect(dragAxis(12, 4)).toBe("x");
		expect(dragAxis(-12, 4)).toBe("x");
	});
	test("mostly vertical commits to y", () => {
		expect(dragAxis(4, 12)).toBe("y");
	});
	test("a diagonal tie goes to y so scrolling wins", () => {
		expect(dragAxis(10, 10)).toBe("y");
	});
});

describe("settleSheet", () => {
	const both = ["half", "full"] as const;
	test("dragging a half sheet down past the threshold closes it", () => {
		expect(settleSheet(120, "half", both)).toBe("closed");
	});
	test("dragging a full sheet down drops to half", () => {
		expect(settleSheet(120, "full", both)).toBe("half");
	});
	test("a full sheet closes when half is not allowed", () => {
		expect(settleSheet(120, "full", ["full"])).toBe("closed");
	});
	test("dragging a half sheet up expands it", () => {
		expect(settleSheet(-60, "half", both)).toBe("full");
	});
	test("a half sheet stays when full is not allowed", () => {
		expect(settleSheet(-60, "half", ["half"])).toBe("half");
	});
	test("a small drag stays put", () => {
		expect(settleSheet(40, "half", both)).toBe("half");
		expect(settleSheet(-20, "half", both)).toBe("half");
	});
});
