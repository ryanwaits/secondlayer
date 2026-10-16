import { describe, expect, test } from "bun:test";
import { safeNextPath, signInThen } from "./safe-next";

describe("safeNextPath", () => {
	test("keeps a same-origin path with its query", () => {
		expect(safeNextPath("/cli/login?code=WDJB-MJHT")).toBe(
			"/cli/login?code=WDJB-MJHT",
		);
		expect(safeNextPath("/account/keys")).toBe("/account/keys");
	});

	test("rejects protocol-relative and absolute URLs", () => {
		expect(safeNextPath("//evil.com")).toBe("/account");
		expect(safeNextPath("https://evil.com/x")).toBe("/account");
		expect(safeNextPath("javascript:alert(1)")).toBe("/account");
		expect(safeNextPath("/\\evil.com")).toBe("/account");
		expect(safeNextPath("/\t/evil.com")).toBe("/account");
	});

	test("falls back when missing", () => {
		expect(safeNextPath(null)).toBe("/account");
		expect(safeNextPath("")).toBe("/account");
		expect(safeNextPath(undefined, "/x")).toBe("/x");
	});
});

describe("signInThen", () => {
	test("encodes the return path whole", () => {
		const href = signInThen("/cli/login?code=WDJB-MJHT");
		expect(href).toBe("/signin?next=%2Fcli%2Flogin%3Fcode%3DWDJB-MJHT");
		expect(
			safeNextPath(new URL(href, "http://x").searchParams.get("next")),
		).toBe("/cli/login?code=WDJB-MJHT");
	});
});
