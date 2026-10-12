import { describe, expect, mock, test } from "bun:test";
import { PRODUCTS } from "@/lib/site";
import { renderToStaticMarkup } from "react-dom/server";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { SiteFooter } = await import("@/components/site-footer");
const { StatusDot } = await import("./status-dot");
const { RestOfPlatform } = await import("./rest-of-platform");

describe("marketing shell", () => {
	test("PRODUCTS lists the five products in brand order", () => {
		expect(PRODUCTS.map((p) => p.noun)).toEqual([
			"Archive",
			"Streams",
			"Index",
			"Subgraphs",
			"Webhooks",
		]);
	});

	test("footer links every product and GitHub, without the old org URL", () => {
		const html = renderToStaticMarkup(<SiteFooter />);
		for (const p of PRODUCTS) expect(html).toContain(`href="${p.href}"`);
		expect(html).toContain("GitHub");
		expect(html).not.toContain("secondlayer-labs");
	});

	test("rest of the platform leaves out the excluded product", () => {
		const html = renderToStaticMarkup(
			<RestOfPlatform exclude={["/p/index"]} />,
		);
		expect(html).not.toContain('href="/p/index"');
		expect(html).toContain('href="/p/archive"');
	});

	test("a soon status is a neutral ring, never yellow", () => {
		const html = renderToStaticMarkup(<StatusDot state="soon" />);
		expect(html).toContain("status soon");
		expect(html).not.toMatch(/--hi|yellow|\bhl\b/);
	});
});
