import { describe, expect, test } from "bun:test";
import {
	markdownFence,
	parseAnnotations,
	parseFenceOptions,
	stripAnnotations,
} from "./annotations";

describe("parseFenceOptions", () => {
	test("the first bare token with a dot, slash or tilde is the title", () => {
		expect(parseFenceOptions("ts consumer.ts").title).toBe("consumer.ts");
		expect(parseFenceOptions("sh ~/indexer").title).toBe("~/indexer");
		expect(parseFenceOptions("json src/response").title).toBe("src/response");
	});

	test("language aliases normalize to the highlighter's names", () => {
		expect(parseFenceOptions("ts").lang).toBe("typescript");
		expect(parseFenceOptions("sh").lang).toBe("bash");
		expect(parseFenceOptions("unknownlang").lang).toBe("text");
	});

	test("lines alone starts at 1 and lines=N starts at N", () => {
		expect(parseFenceOptions("ts lines").lines).toBe(1);
		expect(parseFenceOptions("ts lines=31").lines).toBe(31);
		expect(parseFenceOptions("ts").lines).toBeUndefined();
	});

	test("flags and numeric options are read from the rest of the line", () => {
		expect(parseFenceOptions("sh nocopy wrap max=8 exit=1")).toEqual({
			lang: "bash",
			nocopy: true,
			wrap: true,
			max: 8,
			exit: 1,
		});
	});

	test("status sets the bar's chip and base opts into the Base URL switch", () => {
		expect(parseFenceOptions("json status=404")).toEqual({
			lang: "json",
			status: 404,
		});
		expect(parseFenceOptions("sh base").base).toBe(true);
	});

	test("a figure token turns the fence into a figure", () => {
		expect(parseFenceOptions("ts index.ts figure")).toEqual({
			lang: "typescript",
			title: "index.ts",
			figure: true,
		});
	});

	test("figure is not mistaken for a title", () => {
		expect(parseFenceOptions("ts figure").title).toBeUndefined();
	});

	test("a key=value token is never mistaken for the title", () => {
		expect(parseFenceOptions("ts max=3.5").title).toBeUndefined();
	});
});

describe("parseAnnotations", () => {
	test("an annotation line is removed and targets the next output line", () => {
		const parsed = parseAnnotations("a\n// !mark\nb\nc", "ts");
		expect(parsed.lines).toEqual(["a", "b", "c"]);
		expect(parsed.annotations).toMatchObject([
			{ name: "mark", from: 1, to: 1, regex: null },
		]);
	});

	test("a range annotation targets lines relative to the comment", () => {
		const parsed = parseAnnotations("// !mark(2:3)\nx\ny\nz\nw", "ts");
		expect(parsed.annotations[0]).toMatchObject({ from: 1, to: 2 });
	});

	test("a single-number range targets one line", () => {
		const parsed = parseAnnotations("// !mark(2)\nx\ny", "ts");
		expect(parsed.annotations[0]).toMatchObject({ from: 1, to: 1 });
	});

	test("the regex selects the first match unless the g flag asks for all", () => {
		const first = parseAnnotations("// !mark[/a/]\nbanana", "ts")
			.annotations[0];
		const all = parseAnnotations("// !mark[/a/g]\nbanana", "ts").annotations[0];
		expect("banana".match(first?.regex as RegExp)?.index).toBe(1);
		expect([..."banana".matchAll(all?.regex as RegExp)]).toHaveLength(3);
	});

	test("range and regex combine in either order", () => {
		const a = parseAnnotations("// !mark(1:2)[/x/] note\nx\nx", "ts");
		const b = parseAnnotations("// !mark[/x/](1:2) note\nx\nx", "ts");
		for (const parsed of [a, b]) {
			expect(parsed.annotations[0]).toMatchObject({
				from: 0,
				to: 1,
				value: "note",
			});
			expect(parsed.annotations[0]?.regex?.source).toBe("x");
		}
	});

	test("the value is the free text after the selectors", () => {
		const parsed = parseAnnotations(
			"// !callout[/fromCursor/] Null on the first run.\nfromCursor",
			"ts",
		);
		expect(parsed.annotations[0]?.value).toBe("Null on the first run.");
	});

	test("each language uses its own comment token", () => {
		expect(parseAnnotations("# !mark\nx", "sh").lines).toEqual(["x"]);
		expect(parseAnnotations("-- !mark\nx", "sql").lines).toEqual(["x"]);
		expect(parseAnnotations(";; !mark\nx", "clarity").lines).toEqual(["x"]);
		expect(parseAnnotations("// !mark\nx", "sh").lines).toEqual([
			"// !mark",
			"x",
		]);
	});

	test("a sol fence reads // annotations like any C-family language", () => {
		const parsed = parseAnnotations(
			"// !callout[/nonReentrant/] blocks re-entry\nfunction f() external nonReentrant {}",
			"sol",
		);
		expect(parsed.lines).toEqual(["function f() external nonReentrant {}"]);
		expect(parsed.annotations[0]?.name).toBe("callout");
	});

	test("json fences accept // annotations", () => {
		const parsed = parseAnnotations('{\n  // !mark\n  "a": 1\n}', "json");
		expect(parsed.lines).toEqual(["{", '  "a": 1', "}"]);
		expect(parsed.annotations[0]?.from).toBe(1);
	});

	test("an indented annotation comment is still an annotation", () => {
		expect(parseAnnotations("f(\n    // !mark\n  x)", "ts").lines).toEqual([
			"f(",
			"  x)",
		]);
	});

	test("ordinary comments that merely mention a bang stay in the output", () => {
		const parsed = parseAnnotations("// not! an annotation\nx", "ts");
		expect(parsed.lines).toHaveLength(2);
		expect(parsed.annotations).toEqual([]);
	});

	test("unknown names still parse so the budget lint can report them", () => {
		expect(parseAnnotations("// !wobble\nx", "ts").annotations[0]?.name).toBe(
			"wobble",
		);
	});

	test("stripAnnotations leaves the source text for anywhere text leaves the page", () => {
		expect(
			stripAnnotations("a\n// !callout[/b/] hi\nb\n// !mark\nc", "ts"),
		).toBe("a\nb\nc");
	});
});

describe("markdownFence", () => {
	test("a callout becomes a comment in the markdown twin", () => {
		expect(
			markdownFence("ts", "a\n// !callout[/b/] hi\nb\n// !mark\nc").body,
		).toBe("a\n// hi\nb\nc");
		expect(markdownFence("ts", "f({\n// !callout hi\n  a: 1,\n})").body).toBe(
			"f({\n  // hi\n  a: 1,\n})",
		);
		expect(markdownFence("sh", "# !callout note\nx").body).toBe("# note\nx");
		expect(markdownFence("clarity", ";; !callout n\n(x)").body).toBe(
			";; n\n(x)",
		);
	});

	test("a callout in a text fence is dropped from the markdown twin", () => {
		expect(markdownFence("text", "# !callout note\nok").body).toBe("ok");
	});

	test("a mark line never reaches the markdown twin", () => {
		const out = markdownFence(
			"ts",
			"// !mark[/a/]\nconst a = 1;\n// !focus\nb",
		);
		expect(out.body).toBe("const a = 1;\nb");
		expect(out.info).toBe("ts");
	});
});
