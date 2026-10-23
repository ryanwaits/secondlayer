import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TerminalBlock } from "./terminal-block";

describe("TerminalBlock", () => {
	test("shows the CLI, Claude Code and skill commands", () => {
		const html = renderToStaticMarkup(<TerminalBlock />);
		expect(html).toContain("Work from your terminal");
		expect(html).toContain("npx @secondlayer/cli login");
		expect(html).toContain(
			"claude mcp add --transport http secondlayer https://api.secondlayer.tools/mcp",
		);
		expect(html).toContain(
			"bunx skills add ryanwaits/secondlayer --skill secondlayer -y",
		);
	});
});
