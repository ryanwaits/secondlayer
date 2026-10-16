import { describe, expect, test } from "bun:test";
import { CreateKeyError } from "@/lib/account-data";
import { renderToStaticMarkup } from "react-dom/server";
import {
	NameStep,
	RevealStep,
	USE_IT_TABS,
	type UseItTab,
	createErrorMessage,
	duplicateName,
	nameError,
	useItSnippets,
} from "./new-key-flow";

const KEY = "sk-sl_0123456789abcdef0123456789abcdef";
const noop = () => {};

describe("NameStep", () => {
	test("asks for a name where it runs, with a hint about one key per place", () => {
		const html = renderToStaticMarkup(
			<NameStep onSubmit={noop} onCancel={noop} />,
		);
		expect(html).toContain("Name it for where it runs");
		expect(html).toContain("laptop, ci, prod-indexer");
		expect(html).toContain("One key per place it runs");
		expect(html).toContain('maxLength="64"');
	});

	test("an empty or blank name is refused with a message", () => {
		expect(nameError("")).toBe("Give the key a name");
		expect(nameError("   ")).toBe("Give the key a name");
		expect(nameError("ci")).toBeNull();
	});

	test("an API error shows under the field", () => {
		const html = renderToStaticMarkup(
			<NameStep
				error="You have 50 keys. Revoke one to make another."
				onSubmit={noop}
				onCancel={noop}
			/>,
		);
		expect(html).toContain("You have 50 keys. Revoke one to make another.");
	});

	test("a name you already use warns with a yellow dot but does not block", () => {
		const html = renderToStaticMarkup(
			<NameStep
				initialName="laptop"
				existingNames={["Laptop", "ci"]}
				onSubmit={noop}
				onCancel={noop}
			/>,
		);
		expect(html).toContain("You already have a key called Laptop.");
		expect(html).toContain("dash-dot hi");
		expect(html).not.toContain("disabled");
		expect(html).toContain("Create key");
	});

	test("a new name shows no warning", () => {
		const html = renderToStaticMarkup(
			<NameStep
				initialName="ci"
				existingNames={["laptop"]}
				onSubmit={noop}
				onCancel={noop}
			/>,
		);
		expect(html).not.toContain("already have a key");
	});

	test("the counter appears once the name passes 48 characters", () => {
		const long = "a".repeat(49);
		const over = renderToStaticMarkup(
			<NameStep initialName={long} onSubmit={noop} onCancel={noop} />,
		);
		expect(over).toContain("49/64");
		const under = renderToStaticMarkup(
			<NameStep initialName={"a".repeat(48)} onSubmit={noop} onCancel={noop} />,
		);
		expect(under).not.toContain("/64");
	});

	test("while creating, the button says so and the inputs are disabled", () => {
		const html = renderToStaticMarkup(
			<NameStep busy initialName="ci" onSubmit={noop} onCancel={noop} />,
		);
		expect(html).toContain("Creating…");
		expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);
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

	test("shows the whole key once, with its name and a Copy button", () => {
		const html = render();
		expect(html).toContain("Copy it now.");
		expect(html).toContain("This is the only time you&#x27;ll see the whole");
		expect(html).toContain(KEY);
		expect(html).toContain("laptop");
		expect(html).toContain(">Copy<");
		expect(html).toContain(
			"Lost it? Revoke this one and make another. We never show it again.",
		);
	});

	test("offers CLI, Env, SDK and Agent", () => {
		const html = render();
		for (const t of USE_IT_TABS) expect(html).toContain(`>${t.label}<`);
	});

	test("the CLI tab pipes the clipboard into sl login", () => {
		const html = render("cli");
		expect(html).toContain("pbpaste | sl login --with-token");
		expect(html).toContain("The CLI stores it for every sl command.");
	});

	test("the Env tab shows the prefix, never the whole key, in the block", () => {
		const html = render("env");
		expect(html).toContain("export SECONDLAYER_API_KEY=sk-sl_01234567…");
		expect(html).toContain(
			"The SDK, the CLI and the MCP server all read this variable.",
		);
		// The only whole key on screen is the reveal row.
		expect(html.split(KEY).length - 1).toBe(1);
	});

	test("the SDK tab reads the key from the environment", () => {
		const html = render("sdk");
		expect(html).toContain("process.env.SECONDLAYER_API_KEY");
		expect(html).toContain("new SecondLayer");
		expect(html).toContain("Keep the key in your environment, never in the");
	});

	test("the Agent tab is the .mcp.json block with the key prefix", () => {
		const html = render("agent");
		expect(html).toContain("@secondlayer/mcp");
		expect(html).toContain("sk-sl_01234567…");
		expect(html).toContain("Paste into .mcp.json.");
	});

	test("Copy on Env and Agent carries the whole key; CLI and SDK carry none", () => {
		const s = useItSnippets(KEY);
		expect(s.env.copy).toBe(`export SECONDLAYER_API_KEY=${KEY}`);
		expect(s.agent.copy).toContain(`"SECONDLAYER_API_KEY": "${KEY}"`);
		expect(s.cli.copy).not.toContain("sk-sl_");
		expect(s.sdk.copy).not.toContain("sk-sl_");
	});
});
