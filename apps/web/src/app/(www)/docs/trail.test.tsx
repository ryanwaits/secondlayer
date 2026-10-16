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

describe("the trail bar with Saved", () => {
	const slot = {
		path: "/docs/subgraphs",
		scrollY: 1200,
		linkIndex: 3,
		label: "Handler context",
	};
	const saved = [
		{
			href: "/docs/webhooks#print-fields",
			title: "Print fields",
			pageTitle: "Webhooks",
			kind: "section" as const,
			from: { path: "/docs/subgraphs", label: "Handler context" },
			savedAt: 1,
		},
		{
			href: "/docs/index",
			title: "Index",
			pageTitle: "Index",
			kind: "page" as const,
			from: { path: "/docs/subgraphs", label: "Reading the chain" },
			savedAt: 2,
		},
	];

	test("shows the count, and a hairline between it and Back", () => {
		const html = renderToStaticMarkup(
			<TrailBar slot={slot} saved={saved} onBack={() => {}} />,
		);
		expect(html).toContain("Back to <b>Handler context</b>");
		expect(html).toContain("Saved <b>2</b>");
		expect(html).toContain("docs-trail-sep");
		expect(html).not.toContain("docs-trail-list");
	});

	test("with only Saved there is no divider and no Back", () => {
		const html = renderToStaticMarkup(
			<TrailBar slot={null} saved={saved} onBack={() => {}} />,
		);
		expect(html).toContain("Saved <b>2</b>");
		expect(html).not.toContain("docs-trail-sep");
		expect(html).not.toContain("docs-trail-back");
	});

	test("with only Back there is no divider and no Saved", () => {
		const html = renderToStaticMarkup(
			<TrailBar slot={slot} onBack={() => {}} />,
		);
		expect(html).toContain("docs-trail-back");
		expect(html).not.toContain("docs-trail-sep");
		expect(html).not.toContain("docs-trail-saved");
	});

	test("an open list has a row per item, newest first, with where it came from", () => {
		const html = renderToStaticMarkup(
			<TrailBar slot={null} saved={saved} listOpen onBack={() => {}} />,
		);
		expect(html.indexOf("Index")).toBeLessThan(html.indexOf("Print fields"));
		expect(html).toContain("from Handler context");
		expect(html).toContain("from Reading the chain");
		expect(html).toContain('aria-label="Remove Print fields"');
		// A page peek's title is its page: the page title is not repeated.
		expect(html.match(/docs-trail-sub/g)).toHaveLength(1);
	});
});
