import { afterEach, describe, expect, jest, test } from "bun:test";
import { createFlash } from "./use-copied";

afterEach(() => jest.useRealTimers());

describe("createFlash", () => {
	test("turns on, then off after the wait", () => {
		jest.useFakeTimers();
		const seen: boolean[] = [];
		const flash = createFlash(1000, (on) => seen.push(on));
		flash.fire();
		jest.advanceTimersByTime(999);
		expect(seen).toEqual([true]);
		jest.advanceTimersByTime(1);
		expect(seen).toEqual([true, false]);
	});

	test("firing again restarts the wait instead of ending early", () => {
		jest.useFakeTimers();
		const seen: boolean[] = [];
		const flash = createFlash(1000, (on) => seen.push(on));
		flash.fire();
		jest.advanceTimersByTime(600);
		flash.fire();
		jest.advanceTimersByTime(600);
		expect(seen).toEqual([true, true]);
		jest.advanceTimersByTime(400);
		expect(seen).toEqual([true, true, false]);
	});

	test("cancel leaves no timer behind", () => {
		jest.useFakeTimers();
		const seen: boolean[] = [];
		const flash = createFlash(1000, (on) => seen.push(on));
		flash.fire();
		flash.cancel();
		jest.advanceTimersByTime(5000);
		expect(seen).toEqual([true]);
	});
});
