import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Screens that show many links at once. A bare `<Link>` there prefetches every
// one on viewport entry, and each dynamic target is a full server render.
const MANY_LINK_SURFACES = [
	"site-footer.tsx",
	"account/overview/plumbing-strip.tsx",
	"dashboard/shell/resource-row.tsx",
];

describe("pages with many links prefetch on intent only", () => {
	for (const file of MANY_LINK_SURFACES) {
		test(`${file} has no viewport-prefetching <Link>`, () => {
			const source = readFileSync(join(import.meta.dir, file), "utf8");
			expect(source).not.toMatch(/<Link[\s>]/);
			expect(source).not.toContain('from "next/link"');
		});
	}

	test("the account nav's desktop links are intent links", () => {
		const source = readFileSync(
			join(import.meta.dir, "marketing-nav.tsx"),
			"utf8",
		);
		// Only the mobile sheet, which exists once opened, keeps plain links.
		const [beforeSheet] = source.split('className="mnav-sheet"');
		expect(beforeSheet).not.toMatch(/<Link[\s>]/);
	});

	test("intent-link turns viewport prefetch off", () => {
		const source = readFileSync(
			join(import.meta.dir, "intent-link.tsx"),
			"utf8",
		);
		expect(source).toContain("prefetch={false}");
	});
});
