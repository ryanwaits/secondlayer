import { describe, expect, it } from "bun:test";
import {
	DEFAULT_MINT_TIER,
	assertCanMint,
	resolveMintProduct,
} from "./mint.ts";

describe("assertCanMint (owner-gate)", () => {
	it("allows a dashboard session", () => {
		expect(() => assertCanMint({ isSession: true })).not.toThrow();
	});

	it("allows an account-product key (owner)", () => {
		expect(() =>
			assertCanMint({ isSession: false, apiKeyProduct: "account" }),
		).not.toThrow();
	});

	it("rejects a scoped streams key (no privilege escalation)", () => {
		expect(() =>
			assertCanMint({ isSession: false, apiKeyProduct: "streams" }),
		).toThrow();
	});

	it("rejects a scoped index key", () => {
		expect(() =>
			assertCanMint({ isSession: false, apiKeyProduct: "index" }),
		).toThrow();
	});

	it("rejects an api-key caller with no product", () => {
		expect(() =>
			assertCanMint({ isSession: false, apiKeyProduct: null }),
		).toThrow();
	});
});

describe("resolveMintProduct", () => {
	const session = { isSession: true };
	const owner = { isSession: false, apiKeyProduct: "account" };

	it("lets a session mint any product (incl. account)", () => {
		expect(resolveMintProduct(session, "account")).toBe("account");
		expect(resolveMintProduct(session, "streams")).toBe("streams");
		expect(resolveMintProduct(session, undefined)).toBe("account");
	});

	it("confines a non-session caller to scoped products", () => {
		expect(resolveMintProduct(owner, "streams")).toBe("streams");
		expect(resolveMintProduct(owner, "index")).toBe("index");
		expect(resolveMintProduct(owner, undefined)).toBe("streams");
	});

	it("rejects a non-session caller asking for an account key", () => {
		expect(() => resolveMintProduct(owner, "account")).toThrow();
	});
});

describe("DEFAULT_MINT_TIER", () => {
	it("is the tier the credit-gated read path meters (read-credits.ts)", () => {
		expect(DEFAULT_MINT_TIER).toBe("free");
	});
});
