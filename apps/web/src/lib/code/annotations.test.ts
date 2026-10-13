import { describe, expect, test } from "bun:test";
import {
	copyText,
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
});

describe("copy text", () => {
	test("annotation lines never reach copy text", () => {
		const parsed = parseAnnotations(
			"a\n// !callout[/b/] hi\nb\n// !mark\nc",
			"ts",
		);
		expect(copyText(parsed)).toBe("a\nb\nc");
		expect(stripAnnotations("a\n// !mark\nb", "ts")).toBe("a\nb");
	});

	test("removed diff lines are left out of copy text", () => {
		const parsed = parseAnnotations(
			"a\n// !diff -\nold\n// !diff +\nnew\nz",
			"ts",
		);
		expect(copyText(parsed)).toBe("a\nnew\nz");
	});
});
