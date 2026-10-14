import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...path: string[]) => readFileSync(join(...path), "utf8");
const globals = read(import.meta.dir, "..", "globals.css");
const lab = read(import.meta.dir, "lab.css");

/** `--token: value` pairs in one block of CSS, whitespace collapsed. */
function tokens(block: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const match of block.matchAll(/(--[\w-]+):\s*([^;]+);/g))
		out.set(match[1], match[2].replace(/\s+/g, " ").trim());
	return out;
}

/** The text between `open` and the first line that closes it at `close`. */
function block(css: string, open: string, close: string): string {
	const start = css.indexOf(open);
	expect(start, open).toBeGreaterThanOrEqual(0);
	return css.slice(start, css.indexOf(close, start));
}

const light = tokens(block(globals, ":root {", "\n}"));
const dark = new Map([
	...light,
	...tokens(
		block(globals, "@media (prefers-color-scheme: dark) {\n\t:root {", "\n\t}"),
	),
]);

const frame = (mode: "light" | "dark") =>
	tokens(block(lab, `.lab-fr[data-mode="${mode}"] {`, "\n}"));

describe("lab frame tokens", () => {
	test("the light frame declares every :root token with its value", () => {
		expect(Object.fromEntries(frame("light"))).toEqual(
			Object.fromEntries(light),
		);
	});

	test("the dark frame is :root with the first dark block laid over it", () => {
		expect(Object.fromEntries(frame("dark"))).toEqual(Object.fromEntries(dark));
	});

	test("the frames cover the role tokens and the figure tokens", () => {
		for (const name of [
			"--paper",
			"--ink",
			"--pri",
			"--fig-role-a",
			"--fig-ok",
		])
			expect(frame("dark").has(name), name).toBe(true);
	});
});
