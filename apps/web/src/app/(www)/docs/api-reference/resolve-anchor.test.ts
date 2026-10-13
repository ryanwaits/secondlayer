import { describe, expect, test } from "bun:test";
import { resolveAnchor } from "./resolve-anchor";

const anchors = { "list-ft-transfers": 1, "ft-transfer-object": 1 };

describe("drawer hash", () => {
	test("an endpoint or object anchor opens itself", () => {
		expect(resolveAnchor(anchors, "#list-ft-transfers")).toBe(
			"list-ft-transfers",
		);
		expect(resolveAnchor(anchors, "ft-transfer-object")).toBe(
			"ft-transfer-object",
		);
	});

	test("a parameter link opens its endpoint", () => {
		expect(resolveAnchor(anchors, "#list-ft-transfers.limit")).toBe(
			"list-ft-transfers",
		);
		expect(resolveAnchor(anchors, "#list-ft-transfers.body.sender")).toBe(
			"list-ft-transfers",
		);
	});

	test("an object attribute link opens its object", () => {
		expect(resolveAnchor(anchors, "#ft-transfer.amount")).toBe(
			"ft-transfer-object",
		);
	});

	test("a family heading, an empty hash or a bad escape name nothing", () => {
		expect(resolveAnchor(anchors, "#events")).toBeNull();
		expect(resolveAnchor(anchors, "#toString")).toBeNull();
		expect(resolveAnchor(anchors, "")).toBeNull();
		expect(resolveAnchor(anchors, "#%E0%A4%A")).toBeNull();
	});
});
