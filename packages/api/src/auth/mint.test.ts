import { describe, expect, it } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
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
		expect(resolveMintProduct(session, "index")).toBe("index");
		expect(resolveMintProduct(session, undefined)).toBe("account");
	});

	it("non-session account key mints account keys only", () => {
		expect(resolveMintProduct(owner, undefined)).toBe("account");
		expect(resolveMintProduct(owner, "account")).toBe("account");
	});

	it("rejects a non-session caller asking for streams/index", () => {
		expect(() => resolveMintProduct(owner, "streams")).toThrow(ValidationError);
		expect(() => resolveMintProduct(owner, "index")).toThrow(ValidationError);
	});
});

describe("DEFAULT_MINT_TIER", () => {
	it("is the tier the credit-gated read path meters (read-credits.ts)", () => {
		expect(DEFAULT_MINT_TIER).toBe("free");
	});
});
