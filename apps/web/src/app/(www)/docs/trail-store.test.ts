import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type BackSlot,
	TRAIL_EVENT,
	leavesScreen,
	peekBack,
	setBack,
	setPendingRestore,
	takeBack,
	takePendingRestore,
} from "./trail-store";

const slot = (label: string): BackSlot => ({
	path: "/docs/subgraphs",
	scrollY: 1200,
	linkIndex: 3,
	label,
});

describe("leavesScreen", () => {
	const view = { paddingTop: 84, viewportHeight: 800 };

	test("a link two viewports above its target leaves", () => {
		expect(
			leavesScreen({
				...view,
				linkTop: 400,
				linkBottom: 420,
				targetTop: 2000,
			}),
		).toBe(true);
	});

	test("a target just below the link keeps it on screen", () => {
		// The jump puts the target at the padding line, so only a target within
		// the padding of the link leaves the link visible.
		expect(
			leavesScreen({ ...view, linkTop: 400, linkBottom: 420, targetTop: 440 }),
		).toBe(false);
		expect(
			leavesScreen({ ...view, linkTop: 400, linkBottom: 420, targetTop: 600 }),
		).toBe(true);
	});

	test("a link partly visible at the bottom stays on screen", () => {
		// Landing is 0 (target is above the padding), so the link sits where it is.
		expect(
			leavesScreen({ ...view, linkTop: 730, linkBottom: 750, targetTop: 50 }),
		).toBe(false);
		// Fully under the bar's reserved strip, it has left.
		expect(
			leavesScreen({ ...view, linkTop: 760, linkBottom: 780, targetTop: 50 }),
		).toBe(true);
	});

	test("a target near the page end can only scroll as far as the page does", () => {
		expect(
			leavesScreen({
				...view,
				linkTop: 400,
				linkBottom: 420,
				targetTop: 2000,
				maxScroll: 100,
			}),
		).toBe(false);
	});
});

describe("the slot", () => {
	const store = new Map<string, string>();
	const events: string[] = [];
	let target = new EventTarget();

	beforeEach(() => {
		target = new EventTarget();
		store.clear();
		events.length = 0;
		globalThis.sessionStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
		} as unknown as Storage;
		globalThis.window = target as unknown as Window & typeof globalThis;
		target.addEventListener(TRAIL_EVENT, () => events.push(TRAIL_EVENT));
	});

	afterEach(() => {
		// @ts-expect-error restoring the bare test environment
		globalThis.sessionStorage = undefined;
		// @ts-expect-error restoring the bare test environment
		globalThis.window = undefined;
	});

	test("the second jump replaces the first and taking clears it", () => {
		setBack(slot("Handler context"));
		setBack(slot("Reading the chain"));
		expect(peekBack()?.label).toBe("Reading the chain");
		expect(takeBack()?.label).toBe("Reading the chain");
		expect(peekBack()).toBeNull();
		expect(takeBack()).toBeNull();
	});

	test("every change is announced", () => {
		setBack(slot("Handler context"));
		takeBack();
		expect(events).toEqual([TRAIL_EVENT, TRAIL_EVENT]);
	});

	test("something that is not a slot reads as empty", () => {
		store.set("sl.docs.back", "{not json");
		expect(peekBack()).toBeNull();
		store.set("sl.docs.back", JSON.stringify({ path: "https://evil.com" }));
		expect(peekBack()).toBeNull();
	});

	test("a pending restore is read once", () => {
		setPendingRestore(640);
		expect(takePendingRestore()).toBe(640);
		expect(takePendingRestore()).toBeNull();
	});
});

describe("storage that throws", () => {
	test("changes nothing and throws nothing", () => {
		globalThis.sessionStorage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("blocked");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		} as unknown as Storage;
		try {
			expect(() => setBack(slot("x"))).not.toThrow();
			expect(peekBack()).toBeNull();
			expect(takeBack()).toBeNull();
			expect(() => setPendingRestore(1)).not.toThrow();
			expect(takePendingRestore()).toBeNull();
		} finally {
			// @ts-expect-error restoring the bare test environment
			globalThis.sessionStorage = undefined;
		}
	});
});
