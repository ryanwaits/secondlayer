import { describe, expect, test } from "bun:test";
import { changedUrls, parseSitemap, routeOf } from "./indexnow";

describe("routeOf", () => {
	test("strips route groups and keeps real index pages on www", () => {
		expect(routeOf("www", "apps/web/src/app/(www)/page.tsx")).toBe("/");
		expect(routeOf("www", "apps/web/src/app/(www)/p/index/page.tsx")).toBe(
			"/p/index",
		);
		expect(
			routeOf(
				"www",
				"apps/web/src/app/(www)/blog/(post)/not-in-any-public-api/page.mdx",
			),
		).toBe("/blog/not-in-any-public-api");
	});

	test("treats index as the folder root on stacks docs", () => {
		expect(routeOf("stacks", "apps/stacks-docs/docs/pages/index.mdx")).toBe(
			"/",
		);
		expect(
			routeOf("stacks", "apps/stacks-docs/docs/pages/guide/pox5.mdx"),
		).toBe("/guide/pox5");
	});

	test("ignores files that are not pages", () => {
		expect(routeOf("www", "apps/web/src/lib/writing.ts")).toBeNull();
		expect(routeOf("www", "apps/stacks-docs/docs/pages/index.mdx")).toBeNull();
		expect(routeOf("stacks", "apps/web/src/app/(www)/page.tsx")).toBeNull();
	});
});

describe("changedUrls", () => {
	const sitemap = [
		"https://www.secondlayer.tools",
		"https://www.secondlayer.tools/verify",
	];

	test("sends only pages in the live sitemap", () => {
		expect(
			changedUrls(
				"www",
				[
					"apps/web/src/app/(www)/page.tsx",
					"apps/web/src/app/(www)/verify/page.tsx",
					"apps/web/src/app/(www)/account/page.tsx",
					"README.md",
				],
				sitemap,
			),
		).toEqual(sitemap);
	});

	test("matches a sitemap that writes the root with a slash", () => {
		expect(
			changedUrls(
				"stacks",
				["apps/stacks-docs/docs/pages/index.mdx"],
				["https://stacks.secondlayer.tools/"],
			),
		).toEqual(["https://stacks.secondlayer.tools/"]);
	});
});

test("parseSitemap reads every loc", () => {
	expect(
		parseSitemap(
			"<urlset><url><loc>https://a.test/</loc></url><url><loc>https://a.test/b</loc></url></urlset>",
		),
	).toEqual(["https://a.test/", "https://a.test/b"]);
});
