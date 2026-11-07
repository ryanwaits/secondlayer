import { describe, expect, test } from "bun:test";
import { CreateKeyError } from "@/lib/account-data";
import { renderToStaticMarkup } from "react-dom/server";
import {
	RevealStep,
	type UseItTab,
	createErrorMessage,
	createKeyDisabled,
	duplicateName,
	nameError,
	useItSnippets,
} from "./new-key-flow";

const KEY = "sk-sl_0123456789abcdef0123456789abcdef";
const noop = () => {};

describe("NameStep", () => {
	test("an empty or blank name is refused with a message", () => {
		expect(nameError("")).toBe("Give the key a name");
		expect(nameError("   ")).toBe("Give the key a name");
		expect(nameError("ci")).toBeNull();
	});

	test("Create key stays disabled until the name has a character, and while busy", () => {
		expect(createKeyDisabled("", false)).toBe(true);
		expect(createKeyDisabled("   ", false)).toBe(true);
		expect(createKeyDisabled("ci", false)).toBe(false);
		expect(createKeyDisabled("ci", true)).toBe(true);
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
	const render = (tab?: UseItTab) =>
		renderToStaticMarkup(
			<RevealStep value={KEY} name="laptop" initialTab={tab} onDone={noop} />,
		);

	test("the Env tab shows the prefix, never the whole key, in the block", () => {
		const html = render("env");
		expect(html).toContain("export SECONDLAYER_API_KEY=sk-sl_01234567…");
		expect(html).toContain(
			"The SDK, the CLI and the MCP server all read this variable.",
		);
		// The only whole key on screen is the reveal row.
		expect(html.split(KEY).length - 1).toBe(1);
	});

	test("Copy on Env and Agent carries the whole key; CLI and SDK carry none", () => {
		const s = useItSnippets(KEY);
		expect(s.env.copy).toBe(`export SECONDLAYER_API_KEY=${KEY}`);
		expect(s.agent.copy).toContain(`"SECONDLAYER_API_KEY": "${KEY}"`);
		expect(s.cli.copy).not.toContain("sk-sl_");
		expect(s.sdk.copy).not.toContain("sk-sl_");
	});
});
