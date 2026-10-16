import { describe, expect, test } from "bun:test";
import {
	rememberNext,
	safeNextPath,
	signInThen,
	takeRememberedNext,
} from "./safe-next";

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

describe("remembered return path", () => {
	const store = new Map<string, string>();
	globalThis.localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
	} as unknown as Storage;

	test("the emailed link returns to the CLI approval page once", () => {
		rememberNext("/cli/login?code=WDJB-MJHT", 1_000);
		expect(takeRememberedNext(2_000)).toBe("/cli/login?code=WDJB-MJHT");
		expect(takeRememberedNext(3_000)).toBe("/account");
	});

	test("a path older than the email's 15 minutes falls back", () => {
		rememberNext("/cli/login?code=WDJB-MJHT", 0);
		expect(takeRememberedNext(16 * 60 * 1000)).toBe("/account");
	});

	test("a tampered stored path still has to be same-origin", () => {
		store.set("sl_next", JSON.stringify({ path: "//evil.com", at: 0 }));
		expect(takeRememberedNext(1)).toBe("/account");
	});
});
