import { describe, expect, test } from "bun:test";
import { activeHeading, isAtScrollEnd } from "./outline-spy";

describe("outline scrollspy", () => {
	test("the first heading is active before any heading reaches the line", () => {
		expect(activeHeading([300, 700, 1200], 92, false)).toBe(0);
	});

	test("the last heading past the line is active, not the topmost visible one", () => {
		expect(activeHeading([-900, -100, 300], 92, false)).toBe(1);
	});

	test("scrolling back up returns to the section you are in", () => {
		expect(activeHeading([-50, 400], 92, false)).toBe(0);
	});

	test("at the scroll end the last heading is active even if it never reaches the line", () => {
		expect(isAtScrollEnd(1100, 900, 2000)).toBe(true);
		expect(isAtScrollEnd(500, 900, 2000)).toBe(false);
		expect(activeHeading([-900, -400, 500], 92, true)).toBe(2);
	});

	test("no headings gives -1", () => {
		expect(activeHeading([], 92, false)).toBe(-1);
		expect(activeHeading([], 92, true)).toBe(-1);
	});
});
