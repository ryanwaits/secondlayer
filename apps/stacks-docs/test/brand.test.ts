import { expect, test } from "bun:test";
import { alpha, brand } from "../docs/brand";

const lower = (roles: Record<string, string>) =>
	Object.fromEntries(
		Object.entries(roles).map(([key, hex]) => [key, hex.toLowerCase()]),
	);

test("brand roles match DESIGN.md frontmatter in both themes", async () => {
	const text = await Bun.file(
		new URL("../../../DESIGN.md", import.meta.url),
	).text();
	const { colors } = Bun.YAML.parse(text.split(/^---$/m)[1]) as {
		colors: { light: Record<string, string>; dark: Record<string, string> };
	};
	expect(lower(brand.light)).toEqual(lower(colors.light));
	expect(lower(brand.dark)).toEqual(lower(colors.dark));
});

test("alpha renders a hex color as rgba", () => {
	expect(alpha("#111111", 0.74)).toBe("rgba(17, 17, 17, 0.74)");
});
