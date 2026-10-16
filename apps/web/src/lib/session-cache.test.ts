import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	MAX_AGE_MS,
	clearSnapshots,
	currentOwner,
	loadSnapshot,
	saveSnapshot,
	setOwner,
} from "./session-cache";

const store = new Map<string, string>();
const realNow = Date.now;

beforeEach(() => {
	store.clear();
	globalThis.sessionStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		key: (i: number) => [...store.keys()][i] ?? null,
		get length() {
			return store.size;
		},
	} as unknown as Storage;
});

afterEach(() => {
	Date.now = realNow;
	// @ts-expect-error restoring the bare test environment
	globalThis.sessionStorage = undefined;
});

describe("session cache", () => {
	test("a saved snapshot loads back", () => {
		saveSnapshot("x", { a: 1 });
		expect(loadSnapshot<{ a: number }>("x")).toEqual({ a: 1 });
	});

	test("a snapshot older than ten minutes reads as nothing", () => {
		saveSnapshot("x", { a: 1 });
		const saved = Date.now();
		Date.now = () => saved + MAX_AGE_MS + 1;
		expect(loadSnapshot("x")).toBeNull();
	});

	test("a snapshot saved for another account reads as nothing", () => {
		setOwner("a");
		saveSnapshot("x", { a: 1 });
		expect(loadSnapshot<{ a: number }>("x")).toEqual({ a: 1 });
		setOwner("b");
		expect(loadSnapshot("x")).toBeNull();
	});

	test("a snapshot saved before the owner was known loads only while it is unknown", () => {
		saveSnapshot("x", { a: 1 });
		expect(loadSnapshot<{ a: number }>("x")).toEqual({ a: 1 });
		setOwner("a");
		expect(loadSnapshot("x")).toBeNull();
	});

	test("an oversize payload is not stored", () => {
		saveSnapshot("x", { big: "y".repeat(300 * 1024) });
		expect(store.size).toBe(0);
		expect(loadSnapshot("x")).toBeNull();
	});

	test("clearing removes every snapshot key and the owner, and leaves other keys", () => {
		setOwner("a");
		saveSnapshot("x", 1);
		saveSnapshot("y", 2);
		store.set("other", "keep");
		clearSnapshots();
		expect([...store.keys()]).toEqual(["other"]);
		expect(currentOwner()).toBeNull();
	});

	test("a corrupt entry reads as nothing", () => {
		store.set("sl:dash:v1:x", "{not json");
		expect(loadSnapshot("x")).toBeNull();
	});
});

describe("without sessionStorage", () => {
	test("every call is a no-op", () => {
		// @ts-expect-error simulating a server or blocked storage
		globalThis.sessionStorage = undefined;
		saveSnapshot("x", 1);
		setOwner("a");
		clearSnapshots();
		expect(loadSnapshot("x")).toBeNull();
		expect(currentOwner()).toBeNull();
	});
});
