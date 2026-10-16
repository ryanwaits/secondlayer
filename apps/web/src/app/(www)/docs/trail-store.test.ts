import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type BackSlot,
	type SavedItem,
	TRAIL_EVENT,
	addSaved,
	headingAbove,
	isSaved,
	leavesScreen,
	listSaved,
	peekBack,
	removeSaved,
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

describe("headingAbove", () => {
	const headings = [
		{ top: -900, text: "Intro" },
		{ top: -120, text: " Handler context " },
		{ top: 340, text: "Reading the chain" },
	];

	test("names the last heading that has reached the line", () => {
		expect(headingAbove(headings, 85)).toBe("Handler context");
		expect(headingAbove(headings, 400)).toBe("Reading the chain");
	});

	test("is null above the first heading, so the caller falls back to the page title", () => {
		expect(headingAbove(headings, -1000)).toBeNull();
		expect(headingAbove([], 85)).toBeNull();
	});

	test("skips a heading with no text", () => {
		expect(
			headingAbove(
				[
					{ top: -50, text: "Intro" },
					{ top: -10, text: "  " },
				],
				85,
			),
		).toBe("Intro");
	});
});

describe("saved", () => {
	const store = new Map<string, string>();
	const events: string[] = [];
	let target = new EventTarget();

	const item = (n: number): Omit<SavedItem, "savedAt"> => ({
		href: `/docs/webhooks#part-${n}`,
		title: `Part ${n}`,
		pageTitle: "Webhooks",
		kind: "section",
		from: { path: "/docs/subgraphs", label: "Handler context" },
	});

	beforeEach(() => {
		target = new EventTarget();
		store.clear();
		events.length = 0;
		globalThis.localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
		} as unknown as Storage;
		globalThis.window = target as unknown as Window & typeof globalThis;
		target.addEventListener(TRAIL_EVENT, () => events.push(TRAIL_EVENT));
	});

	afterEach(() => {
		// @ts-expect-error restoring the bare test environment
		globalThis.localStorage = undefined;
		// @ts-expect-error restoring the bare test environment
		globalThis.window = undefined;
	});

	test("the newest is last", () => {
		addSaved(item(1), 100);
		addSaved(item(2), 200);
		expect(listSaved().map((saved) => saved.title)).toEqual([
			"Part 1",
			"Part 2",
		]);
		expect(listSaved()[1].savedAt).toBe(200);
	});

	test("saving the same href again keeps one, moved to the end", () => {
		addSaved(item(1), 100);
		addSaved(item(2), 200);
		addSaved(item(1), 300);
		expect(listSaved().map((saved) => saved.title)).toEqual([
			"Part 2",
			"Part 1",
		]);
	});

	test("past 50 the oldest drops", () => {
		for (let n = 1; n <= 52; n++) addSaved(item(n), n);
		const saved = listSaved();
		expect(saved).toHaveLength(50);
		expect(saved[0].title).toBe("Part 3");
		expect(saved[49].title).toBe("Part 52");
		expect(isSaved("/docs/webhooks#part-1")).toBe(false);
	});

	test("remove takes one out and every change is announced", () => {
		addSaved(item(1));
		addSaved(item(2));
		removeSaved("/docs/webhooks#part-1");
		expect(listSaved().map((saved) => saved.title)).toEqual(["Part 2"]);
		expect(isSaved("/docs/webhooks#part-2")).toBe(true);
		expect(events).toHaveLength(3);
	});

	test("something that is not a list reads as empty", () => {
		store.set("sl.docs.saved", "{not json");
		expect(listSaved()).toEqual([]);
		store.set(
			"sl.docs.saved",
			JSON.stringify([{ href: "https://evil.com" }, "x"]),
		);
		expect(listSaved()).toEqual([]);
	});

	test("storage that throws changes nothing and throws nothing", () => {
		globalThis.localStorage = {
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
		expect(() => addSaved(item(1))).not.toThrow();
		expect(() => removeSaved("/docs/webhooks#part-1")).not.toThrow();
		expect(listSaved()).toEqual([]);
	});
});
