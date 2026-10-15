import { describe, expect, test } from "bun:test";
import { commandForPath, truncateMiddle } from "./terminal-command";

describe("truncateMiddle", () => {
	test("keeps a 64-char command intact", () => {
		const c = "x".repeat(64);
		expect(truncateMiddle(c)).toBe(c);
	});
	test("cuts a 65-char command", () => {
		expect(truncateMiddle("x".repeat(65))).toHaveLength(57);
	});
	test("cuts a 101-char command to 57 chars with one ellipsis", () => {
		const out = truncateMiddle("a".repeat(101));
		expect(out).toHaveLength(57);
		expect(out.split("…")).toHaveLength(2);
	});
});

describe("commandForPath", () => {
	test("maps each account route to its CLI command", () => {
		expect(commandForPath("/account")).toBe("sl status");
		expect(commandForPath("/account/webhooks")).toBe("sl webhooks list");
		expect(commandForPath("/account/webhooks/wh_1")).toBe(
			"sl webhooks doctor wh_1",
		);
		expect(commandForPath("/account/credits")).toBe("sl credits balance");
		expect(commandForPath("/account/keys")).toBe("sl whoami");
	});
	test("unknown routes get no footer", () => {
		expect(commandForPath("/account/foo")).toBeNull();
		expect(commandForPath(null)).toBeNull();
	});
});
