import { describe, expect, test } from "bun:test";
import { CreateKeyError } from "@/lib/account-data";
import {
	createErrorMessage,
	duplicateName,
	nameError,
	useItSnippets,
} from "./new-key-flow";

const KEY = "sk-sl_0123456789abcdef0123456789abcdef";

describe("NameStep", () => {
	test("an empty or blank name is refused with a message", () => {
		expect(nameError("")).toBe("Give the key a name");
		expect(nameError("   ")).toBe("Give the key a name");
		expect(nameError("ci")).toBeNull();
	});
});

describe("createErrorMessage", () => {
	test("the cap and the rate limit read in plain words", () => {
		expect(createErrorMessage(new CreateKeyError("x", 403))).toBe(
			"You have 50 keys. Revoke one to make another.",
		);
		expect(createErrorMessage(new CreateKeyError("x", 429, 42))).toBe(
			"Too many new keys. Try again in 42s.",
		);
		expect(createErrorMessage(new CreateKeyError("x", 429))).toBe(
			"Too many new keys. Try again later.",
		);
	});

	test("anything else keeps the message it came with", () => {
		expect(createErrorMessage(new CreateKeyError("Sign in first", 401))).toBe(
			"Sign in first",
		);
		expect(createErrorMessage("boom")).toBe("Couldn't create a key");
	});
});

describe("duplicateName", () => {
	test("matches ignoring case and spaces, and ignores empty input", () => {
		expect(duplicateName("  CI ", ["ci"])).toBe("ci");
		expect(duplicateName("", ["ci"])).toBeNull();
		expect(duplicateName("prod", ["ci"])).toBeNull();
	});
});

describe("RevealStep", () => {
	test("Copy on Env and Agent carries the whole key; CLI and SDK carry none", () => {
		const s = useItSnippets(KEY);
		expect(s.env.copy).toBe(`export SECONDLAYER_API_KEY=${KEY}`);
		expect(s.agent.copy).toContain(`"SECONDLAYER_API_KEY": "${KEY}"`);
		expect(s.cli.copy).not.toContain("sk-sl_");
		expect(s.sdk.copy).not.toContain("sk-sl_");
	});
});
