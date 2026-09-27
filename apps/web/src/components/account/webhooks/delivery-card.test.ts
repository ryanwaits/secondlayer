import { describe, expect, test } from "bun:test";
import type { DeliveryRow } from "@secondlayer/sdk";
import { navigateDeliveryId, resolveOpenRow } from "./delivery-card";

function row(id: string): DeliveryRow {
	return {
		id,
		attempt: 1,
		statusCode: 200,
		errorMessage: null,
		durationMs: 100,
		responseBody: null,
		dispatchedAt: "2026-09-01T00:00:00.000Z",
		blockHeight: 100,
		blockTime: "2026-09-01T00:00:00.000Z",
	};
}

const a = row("a");
const b = row("b");
const c = row("c");

describe("resolveOpenRow", () => {
	test("returns null when nothing is open", () => {
		expect(resolveOpenRow([a, b, c], null, null)).toBeNull();
	});

	test("finds the open row by id, ignoring its position", () => {
		expect(resolveOpenRow([a, b, c], "b", null)).toBe(b);
	});

	test("a poll bringing a new row ahead of it still resolves the same delivery", () => {
		// [a,b,c] -> a new delivery n arrives, shifting everything down one slot.
		const n = row("n");
		expect(resolveOpenRow([n, a, b, c], "b", b)).toBe(b);
	});

	test("falls back to the last known snapshot once the id scrolls out of the visible rows", () => {
		// b was the 5th (last) visible row; a newer delivery pushes it out of
		// the slice the table still passes in.
		const f = row("f");
		expect(resolveOpenRow([f, a, b, c], "e", row("e"))).toEqual(row("e"));
	});
});

describe("navigateDeliveryId", () => {
	test("newer from the middle row moves toward index 0", () => {
		expect(navigateDeliveryId([a, b, c], "b", "newer")).toBe("a");
	});

	test("older from the middle row moves toward the end", () => {
		expect(navigateDeliveryId([a, b, c], "b", "older")).toBe("c");
	});

	test("newer at the newest row has nowhere to go", () => {
		expect(navigateDeliveryId([a, b, c], "a", "newer")).toBeNull();
	});

	test("older at the oldest row has nowhere to go", () => {
		expect(navigateDeliveryId([a, b, c], "c", "older")).toBeNull();
	});

	test("an id that has scrolled out of rows can't navigate relative to it", () => {
		expect(navigateDeliveryId([a, b, c], "gone", "older")).toBeNull();
	});
});
