import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/docs/subgraphs",
	useRouter: () => ({ push: () => {} }),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { DocsTrail, TrailBar } = await import("./trail");

describe("the trail bar", () => {
	test("shows nothing without a place to go back to", () => {
		expect(
			renderToStaticMarkup(<TrailBar slot={null} onBack={() => {}} />),
		).toBe("");
		const html = renderToStaticMarkup(<DocsTrail />);
		expect(html).not.toContain("docs-trail-back");
		expect(html).toContain('aria-live="polite"');
	});

	test("names the heading the reader left", () => {
		const html = renderToStaticMarkup(
			<TrailBar
				slot={{
					path: "/docs/subgraphs",
					scrollY: 1200,
					linkIndex: 3,
					label: "Handler context",
				}}
				onBack={() => {}}
			/>,
		);
		expect(html).toContain("Back to <b>Handler context</b>");
		expect(html).toContain('aria-label="Your place"');
	});
});
