import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Code, type CodeProps } from "./code";

async function html(props: CodeProps): Promise<string> {
	return renderToStaticMarkup(await Code(props));
}

describe("ref handler", () => {
	test("!ref with a selector wraps every token and leaves no comment", async () => {
		const out = await html({
			lang: "ts",
			code: [
				"// !ref[/next_cursor/g] next",
				"const a = page.next_cursor + page.next_cursor;",
			].join("\n"),
		});
		expect(out.match(/<span class="ref" data-ref="next">/g)).toHaveLength(2);
		expect(out).not.toContain("!ref");
	});

	test("!ref without a selector names each row in its range", async () => {
		const out = await html({
			lang: "ts",
			code: ["// !ref(1:2) save", "a();", "b();", "c();"].join("\n"),
		});
		expect(out.match(/data-refs="save"/g)).toHaveLength(2);
	});

	test("a row can answer to more than one name", async () => {
		const out = await html({
			lang: "ts",
			code: ["// !ref one", "// !ref two", "a();"].join("\n"),
		});
		expect(out).toContain('data-refs="one two"');
	});

	test("a ref name is one plain word", async () => {
		await expect(
			html({ lang: "ts", code: "// !ref[/x/] two words\nx();" }),
		).rejects.toThrow("name");
	});
});

describe("pick handler", () => {
	test("the declaring token carries the options", async () => {
		const out = await html({
			lang: "ts",
			code: [
				"// !pick[/ft_transfer/] event: ft_transfer | nft_mint | print",
				'types: ["ft_transfer"],',
			].join("\n"),
		});
		expect(out).toMatch(
			/<mark class="hi" data-pick="event" data-opts="ft_transfer\|nft_mint\|print">/,
		);
	});

	test("a bare pick joins a declared name without repeating the options", async () => {
		const out = await html({
			lang: "ts",
			code: ["// !pick[/ft_transfer/] event", 'types: ["ft_transfer"],'].join(
				"\n",
			),
		});
		expect(out).toContain('data-pick="event"');
		expect(out).not.toContain("data-opts");
	});

	test("a pick needs a token and two options at its declaration", async () => {
		await expect(
			html({ lang: "ts", code: "// !pick event: a | b\nx();" }),
		).rejects.toThrow("[/token/]");
		await expect(
			html({ lang: "ts", code: "// !pick[/x/] event: a\nx();" }),
		).rejects.toThrow("two or more");
	});
});
