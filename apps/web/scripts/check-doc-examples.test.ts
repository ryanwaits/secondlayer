import { describe, expect, test } from "bun:test";
import {
	checkDocExamples,
	collectExamples,
	exampleSource,
	missingBuild,
} from "./check-doc-examples";

describe("docs examples", () => {
	test("every checked example compiles against the packages we ship", async () => {
		const problem = missingBuild();
		if (problem) throw new Error(problem);
		const report = await checkDocExamples();
		expect(
			report.failures.map((f) => `${f.where}: ${f.message}`),
			"fix the docs, not the SDK; or list the fence in KNOWN_FAILING with a reason",
		).toEqual([]);
		expect(report.checked + report.ambient.length).toBeGreaterThan(5);
	}, 180_000);

	test("the changelog is not checked against today's SDK", () => {
		const { examples } = collectExamples();
		expect(examples.some((e) => e.where.startsWith("docs/changelog/"))).toBe(
			false,
		);
	});
});

describe("exampleSource", () => {
	test("!error lines get a ts-expect-error above them and annotations leave", () => {
		const source = exampleSource(
			'const a: string = "x";\n// !error[/1/] nope\nconst b: string = 1;\n',
			"ts",
		);
		expect(source).toBe(
			'const a: string = "x";\n// @ts-expect-error\nconst b: string = 1;',
		);
	});

	test("a block without !error is its stripped source", () => {
		expect(exampleSource("// !mark\nconst a = 1;\n", "ts")).toBe(
			"const a = 1;",
		);
	});
});
