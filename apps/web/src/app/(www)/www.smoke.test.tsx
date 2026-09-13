import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DOCS_NAV, docsNavPages } from "./docs/nav";

mock.module("@/components/home/cta-pill", () => ({
	CtaPill: () => (
		<button type="button" className="home-cmd">
			bun add -g @secondlayer/cli
		</button>
	),
}));

// Server component with async shiki blocks; the smoke test pins the shell
// around it, not its highlighting.
mock.module("@/components/home/agent-quickstart", () => ({
	AgentQuickstart: () => <section className="home-qs" />,
}));

mock.module("@/components/notation", () => ({
	Notation: ({ children }: { children: React.ReactNode }) => (
		<span>{children}</span>
	),
}));

const { HomeView } = await import("./page");

describe("www marketing routes", () => {
	/**
	 * Structure and positioning, not wording. This test used to pin the exact
	 * hero headline, which made every copy revision a test failure — the page
	 * can be rewritten freely as long as it still renders and still makes the
	 * self-host claim.
	 */
	test("/ renders the landing page", () => {
		const html = renderToStaticMarkup(<HomeView />);
		expect(html).toContain('class="home"');
		expect(html).toContain('class="home-hero"');
		expect(html).toContain("<h1>");
		expect(html).toContain('class="home-sub"');
		expect(html).toContain('class="home-qs"');
		expect(html).toContain('href="/docs/self-host"');
	});

	test("/ keeps the ownership claim and never implies we host it", () => {
		const html = renderToStaticMarkup(<HomeView />);
		// The claim that survives any headline rewrite: it runs on their box.
		expect(html).toContain("your own");
		expect(html).toContain("beside your node");
		// Withdrawn products must never reappear.
		expect(html).not.toContain("Explore subgraphs is live");
		expect(html).not.toContain("Our decoders.");
		expect(html).not.toContain('href="/subgraphs/explore"');
		// Possessives that would imply we operate their instance (voice rule 6).
		expect(html).not.toContain("our REST");
		expect(html).not.toContain("our API");
		expect(html).not.toContain("hosted indexer");
	});
});

describe("docs sidebar invariant", () => {
	const docsRoot = join(import.meta.dir, "docs");
	const expectedGroups = [
		"Start",
		"Products",
		"Channels",
		"Chain data",
		"Operate",
		"Reference",
		"Stacks client (moves to its own site)",
	] as const;

	test("every docs page is reachable from the sidebar and vice versa", () => {
		expect(DOCS_NAV.map((g) => g.label)).toEqual([...expectedGroups]);

		const navHrefs = new Set(docsNavPages().map((p) => p.href));

		for (const href of navHrefs) {
			const rel =
				href === "/docs"
					? "page.mdx"
					: `${href.slice("/docs/".length)}/page.mdx`;
			expect(existsSync(join(docsRoot, rel))).toBe(true);
		}

		const glob = new Bun.Glob("**/page.mdx");
		for (const path of glob.scanSync({ cwd: docsRoot })) {
			if (path === "changelog/archive/page.mdx") continue;
			const href =
				path === "page.mdx"
					? "/docs"
					: `/docs/${path.replace(/\/page\.mdx$/, "")}`;
			expect(navHrefs.has(href)).toBe(true);
		}
	});
});
