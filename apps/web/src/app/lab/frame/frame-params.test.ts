import { describe, expect, test } from "bun:test";
import { STORIES, getStory } from "../stories";
import { generateStaticParams } from "./[id]/[variant]/[mode]/page";

describe("lab frame routes", () => {
	const params = generateStaticParams();

	test("every static param names a real story variant and a theme", () => {
		for (const { id, variant, mode } of params) {
			expect(getStory(id)?.variants.some((v) => v.id === variant)).toBe(true);
			expect(["light", "dark"]).toContain(mode);
		}
	});

	test("one frame per variant per theme", () => {
		const variants = STORIES.reduce((n, s) => n + s.variants.length, 0);
		expect(params.length).toBe(variants * 2);
		const keys = params.map((p) => `${p.id}/${p.variant}/${p.mode}`);
		expect(new Set(keys).size).toBe(params.length);
	});
});
