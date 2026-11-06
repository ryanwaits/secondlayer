import { describe, expect, test } from "bun:test";
import {
	clearUndo,
	durationFor,
	isUndoShortcut,
	registerUndo,
	takeUndo,
} from "./notify";

describe("durationFor", () => {
	test("busy never times out", () => {
		expect(durationFor("busy")).toBe(Number.POSITIVE_INFINITY);
	});
	test("quick is 2.5 s", () => {
		expect(durationFor("done", { quick: true })).toBe(2500);
	});
	test("failures stay 8 s", () => {
		expect(durationFor("fail")).toBe(8000);
	});
	test("an undo window is 6 s", () => {
		expect(durationFor("done", { undo: () => {} })).toBe(6000);
	});
	test("everything else is 5 s", () => {
		expect(durationFor("ok")).toBe(5000);
		expect(durationFor("done")).toBe(5000);
	});
	test("an explicit duration overrides the table", () => {
		expect(durationFor("done", { duration: 10000 })).toBe(10000);
	});
});

describe("undo registry", () => {
	test("the newest registration wins", () => {
		const a = () => {};
		const b = () => {};
		registerUndo(1, a);
		registerUndo(2, b);
		expect(takeUndo()).toEqual({ id: 2, run: b });
	});
	test("clearUndo only clears the current id", () => {
		registerUndo(1, () => {});
		registerUndo(2, () => {});
		clearUndo(1);
		expect(takeUndo()?.id).toBe(2);
		registerUndo(3, () => {});
		clearUndo(3);
		expect(takeUndo()).toBeNull();
	});
	test("takeUndo clears the shortcut", () => {
		registerUndo(1, () => {});
		takeUndo();
		expect(takeUndo()).toBeNull();
	});
});

describe("isUndoShortcut", () => {
	const base = {
		key: "z",
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		target: null,
	};
	test("meta+z and ctrl+z fire, any case", () => {
		expect(isUndoShortcut({ ...base, metaKey: true })).toBe(true);
		expect(isUndoShortcut({ ...base, ctrlKey: true, key: "Z" })).toBe(true);
	});
	test("no modifier, shift or alt do not fire", () => {
		expect(isUndoShortcut(base)).toBe(false);
		expect(isUndoShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(
			false,
		);
		expect(isUndoShortcut({ ...base, metaKey: true, altKey: true })).toBe(
			false,
		);
	});
	test("typing inside a field does not fire", () => {
		const target = {
			closest: (s: string) => (s.includes("input") ? {} : null),
		} as unknown as EventTarget;
		expect(isUndoShortcut({ ...base, metaKey: true, target })).toBe(false);
	});
});
