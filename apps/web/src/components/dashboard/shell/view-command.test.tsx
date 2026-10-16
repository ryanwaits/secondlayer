import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewCommand } from "./view-command";

describe("ViewCommand", () => {
	test("shows the truncated command and keeps the full one to copy", () => {
		const command = `sl webhooks doctor ${"a".repeat(80)}`;
		const html = renderToStaticMarkup(<ViewCommand command={command} />);
		expect(html).toContain(`data-command="${command}"`);
		const shown = /<code>([^<]*)<\/code>/.exec(html)?.[1] ?? "";
		expect(shown).toHaveLength(33);
		expect(shown).toContain("…");
	});

	test("short commands show as is", () => {
		const html = renderToStaticMarkup(<ViewCommand command="sl status" />);
		expect(html).toContain("<code>sl status</code>");
	});
});
