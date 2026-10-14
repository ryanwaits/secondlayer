import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/docs/streams";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => pathname,
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { DocsView } = await import("./docs-view");

function render(at: string): string {
	pathname = at;
	try {
		return renderToStaticMarkup(
			<DocsView>
				<h1>Page</h1>
			</DocsView>,
		);
	} finally {
		pathname = "/docs/streams";
	}
}

describe("docs page chrome", () => {
	const html = render("/docs/streams");

	test("a page with a markdown twin offers Copy and the .md link", () => {
		expect(html).toContain("Page and agent notes, as Markdown");
		expect(html).toContain('href="/docs/streams.md"');
	});

	test("edit link points at the page's MDX source", () => {
		const href = /href="([^"]*\/docs\/streams\/page\.mdx)"/.exec(html)?.[1];
		expect(href).toBeDefined();
		expect(href).toContain("github.com/");
	});

	test("a page without a markdown twin omits the pills but keeps the edit link", () => {
		const bare = render("/docs/not-in-the-sidebar");
		expect(bare).toContain("Edit on GitHub");
		expect(bare).not.toContain("Page and agent notes, as Markdown");
		expect(bare).not.toContain("not-in-the-sidebar.md");
	});

	test("no page chrome offers a full-view toggle", () => {
		expect(html).not.toContain("Full view");
		expect(render("/docs/api-reference")).not.toContain("Full view");
		expect(render("/docs/api/index")).not.toContain("Full view");
	});

	test("an api page offers Copy and its .md twin", () => {
		const page = render("/docs/api/index");
		expect(page).toContain("Page and agent notes, as Markdown");
		expect(page).toContain('href="/docs/api/index.md"');
	});
});
