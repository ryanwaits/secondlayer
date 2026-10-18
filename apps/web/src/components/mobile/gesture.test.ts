import { describe, expect, test } from "bun:test";
import { dragAxis, rubberband, settleRow, settleSheet } from "./gesture";

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

describe("rubberband", () => {
	test("overshoot past max moves at a quarter speed", () => {
		expect(rubberband(20, -152, 0)).toBe(5);
	});
	test("overshoot past min moves at a quarter speed", () => {
		expect(rubberband(-172, -152, 0)).toBe(-157);
	});
	test("inside the range is unchanged", () => {
		expect(rubberband(-80, -152, 0)).toBe(-80);
	});
});

describe("settleRow", () => {
	test("released past half opens fully", () => {
		expect(settleRow(-80, 152)).toBe(-152);
	});
	test("released short of half closes", () => {
		expect(settleRow(-70, 152)).toBe(0);
	});
	test("a positive offset closes", () => {
		expect(settleRow(10, 152)).toBe(0);
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
