import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCS_NAV, docsNavPages } from "./nav";

// bun's mock.module is process-wide, so stub every export the app imports.
mock.module("next/navigation", () => ({
	usePathname: () => "/docs/streams",
	useRouter: () => ({}),
	useSearchParams: () => new URLSearchParams(),
	useParams: () => ({}),
	notFound: () => {},
	redirect: () => {},
	permanentRedirect: () => {},
}));

const { PageActions, markdownPath, sourcePath, chatPrompt, CHAT_TARGETS } =
	await import("./page-actions");

describe("docs page actions", () => {
	const html = renderToStaticMarkup(<PageActions />);

	test("renders every action row", () => {
		for (const label of [
			"Edit on GitHub",
			"Scroll to top",
			"Copy as Markdown",
			"Export",
			"Open in chat",
			"Connect to MCP",
		]) {
			expect(html).toContain(label);
		}
		expect(html).not.toContain("Full view");
	});

	test("edit link points at the page's MDX source", () => {
		const href = /href="([^"]*\/docs\/streams\/page\.mdx)"/.exec(html)?.[1];
		expect(href).toBeDefined();
		expect(href).toContain("github.com/");
		expect(sourcePath("/docs")).toBe("docs/page.mdx");
	});

	test("export links to the page's markdown and the llms files", () => {
		expect(html).toContain('href="/docs/streams.md"');
		expect(html).toContain('href="/llms.txt"');
		expect(html).toContain('href="/llms-full.txt"');
	});

	test("chat links carry the encoded markdown URL", () => {
		const encoded = encodeURIComponent(
			"https://secondlayer.tools/docs/streams.md",
		);
		expect(CHAT_TARGETS.length).toBeGreaterThan(0);
		for (const target of CHAT_TARGETS) {
			const href = target.href(chatPrompt("/docs/streams"));
			expect(href).toContain(encoded);
			expect(html).toContain(href.replace(/&/g, "&amp;"));
		}
	});

	test("MCP block carries the config the MCP page documents", () => {
		expect(html).toContain("@secondlayer/mcp");
		expect(html).toContain("SECONDLAYER_API_URL");
	});

	test("full view appears only when the page offers it, with its state", () => {
		const off = renderToStaticMarkup(
			<PageActions fullView={{ on: false, toggle: () => {} }} />,
		);
		expect(off).toContain("Full view");
		expect(off).toContain('aria-pressed="false"');
		const on = renderToStaticMarkup(
			<PageActions fullView={{ on: true, toggle: () => {} }} compact />,
		);
		expect(on).toContain("Exit full view");
		expect(on).toContain('aria-label="Copy as Markdown"');
	});

	test("the introduction's markdown twin is introduction.md", () => {
		expect(markdownPath("/docs")).toBe("/docs/introduction.md");
		expect(markdownPath("/docs/")).toBe("/docs/introduction.md");
	});

	test("every nav page has a source path and a markdown path", () => {
		for (const page of docsNavPages()) {
			expect(sourcePath(page.href)).toMatch(
				/^docs(\/.+)?\/page\.mdx$|^docs\/page\.mdx$/,
			);
			expect(markdownPath(page.href)).toMatch(/\.md$/);
		}
		expect(DOCS_NAV.length).toBeGreaterThan(0);
	});
});
