import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LADDER_HEXES } from "@/lib/syntax-theme";

describe("markup", () => {
	test("the stylesheet mirrors the theme's ladder", () => {
		const css = readFileSync(join(import.meta.dir, "code.css"), "utf8");
		for (const [step, hex] of Object.entries(LADDER_HEXES)) {
			const rule = new RegExp(
				`\\.cb \\.t-${step} \\{\\s*--shiki-light: ${hex.light};\\s*--shiki-dark: ${hex.dark};`,
				"i",
			);
			expect(css, step).toMatch(rule);
		}
	});
});
