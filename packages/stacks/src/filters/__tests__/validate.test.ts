import { describe, expect, it } from "bun:test";
import {
	assertContractId,
	assertPrincipalish,
	isPrincipal,
} from "../validate.ts";

const ADDR = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";

describe("filter principal validation", () => {
	it("accepts standard and contract principals", () => {
		expect(isPrincipal(ADDR)).toBe(true);
		expect(isPrincipal(`${ADDR}.sbtc-token`)).toBe(true);
		expect(isPrincipal(`${ADDR}.has_underscore`)).toBe(true);
	});

	it("rejects a contract name that breaks the Clarity grammar", () => {
		// Previously accepted — the name was only checked for non-emptiness, so a
		// typo'd id reached the query and matched zero rows instead of throwing.
		expect(isPrincipal(`${ADDR}.9bad`)).toBe(false);
		expect(isPrincipal(`${ADDR}.-lead`)).toBe(false);
		expect(isPrincipal(`${ADDR}.a${"x".repeat(128)}`)).toBe(false);
	});

	it("rejects a principal carrying more than one dot segment", () => {
		expect(isPrincipal(`${ADDR}.token.extra`)).toBe(false);
	});

	it("rejects a malformed address", () => {
		expect(isPrincipal("garbage")).toBe(false);
		expect(isPrincipal("")).toBe(false);
	});

	it("throws from the assert helpers on a malformed contract name", () => {
		expect(() => assertPrincipalish("sender", `${ADDR}.9bad`)).toThrow(
			/not a valid Stacks principal/,
		);
		expect(() => assertContractId("contractId", `${ADDR}.9bad`)).toThrow(
			/not a valid contract id/,
		);
	});

	it("still short-circuits on wildcard patterns", () => {
		expect(() => assertPrincipalish("sender", `${ADDR}.*`)).not.toThrow();
		expect(() => assertContractId("contractId", "SPB.*")).not.toThrow();
	});
});
