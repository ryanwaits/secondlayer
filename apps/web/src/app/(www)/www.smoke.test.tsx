import { describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DOCS_STRIP } from "@/lib/nav";
import { PRODUCTS } from "@/lib/site";
import { renderAsync } from "@/lib/test-render";
import { DOCS_NAV, docsNavPages } from "./docs/nav";

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

const { HomeView } = await import("./page");

describe("www marketing routes", () => {
	/**
	 * Structure and positioning, not wording. This test used to pin the exact
	 * hero headline, which made every copy revision a test failure — the page
	 * can be rewritten freely as long as it still renders and still makes the
	 * self-host claim.
	 */
	test("/ renders the landing page", async () => {
		const html = await renderAsync(<HomeView />);
		expect(html).toContain('class="site home"');
		expect(html.match(/<h1>/g)).toHaveLength(1);
		for (const p of PRODUCTS) expect(html).toContain(`href="${p.href}"`);
		expect(html).toContain('href="/verify"');
		expect(html).toContain('href="/docs/self-host"');
		expect(html).toContain('href="/docs/self-host#connect-your-node"');
		expect(html).toContain("for apps on Bitcoin.");
		expect(html).toContain("Your box or ours.");
		expect(html).toContain("beside your node");
		expect(html).toContain("example rows");
		expect(html).toContain("Coming soon");
		expect(html).not.toContain("—");
		expect(html).not.toContain("secondlayer-labs");
		expect(html).not.toContain('href="#');
	});

	test("/ states the hosted and self-host paths and no withdrawn products", async () => {
		const html = await renderAsync(<HomeView />);
		expect(html).toContain("for apps on Bitcoin.");
		expect(html).toContain("Your box or ours.");
		expect(html).toContain("beside your node");
		expect(html).toContain('href="/p/subgraphs"');
		expect(html).toContain('href="/p/webhooks"');
		// No stats strip, and nothing withdrawn.
		expect(html).not.toContain("Explore subgraphs is live");
		expect(html).not.toContain('href="/subgraphs/explore"');
	});
});

describe("docs site strip", () => {
	test("session chrome is not hardcoded into the leave-docs links", () => {
		expect(DOCS_STRIP.map((l) => l.label)).toEqual([
			"Home",
			"Archive",
			"Pricing",
			"Docs",
			"Blog",
		]);
		expect(DOCS_STRIP.map((l) => l.href)).not.toContain("/login");
	});
});

describe("docs sidebar invariant", () => {
	const docsRoot = join(import.meta.dir, "docs");
	const expectedGroups = [
		"Start",
		"Products",
		"Verify",
		"Tools",
		"API reference",
		"SDK reference",
		"Reference",
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
			const href =
				path === "page.mdx"
					? "/docs"
					: `/docs/${path.replace(/\/page\.mdx$/, "")}`;
			expect(navHrefs.has(href)).toBe(true);
		}
	});
});
