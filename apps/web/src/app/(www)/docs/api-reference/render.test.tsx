import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { ApiPage } from "./api-reference";
import { pageContent } from "./page-content";
import { API_PAGES, findApiPage } from "./pages";

/** Render a tree to markup, as the build does. */
async function render(element: ReactElement): Promise<string> {
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}

const ids = (html: string) =>
	[...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("an API page", () => {
	test("every API page renders each endpoint inline, with unique anchors", async () => {
		for (const page of API_PAGES) {
			const html = await render(<ApiPage slug={page.slug} />);
			const all = ids(html);
			const dupes = all.filter((id, i) => all.indexOf(id) !== i);
			expect(dupes, `${page.slug}: duplicate ids`).toEqual([]);
			const { families, objects } = pageContent(page);
			const anchors = [
				...families.flatMap((f) => f.endpoints.map((e) => e.anchor)),
				...objects.map((o) => o.anchor),
			];
			for (const anchor of anchors) {
				const heading = new RegExp(`<h3 id="${anchor}"[^>]*data-outline-child`);
				expect(html, `${page.slug}: ${anchor}`).toMatch(heading);
			}
			expect(html).not.toContain("data-endpoint-row");
			expect(html).not.toContain("acct-card");
		}
	});

	test("each endpoint section carries a prompt bar and no task placeholder", async () => {
		const page = findApiPage("streams");
		if (!page) throw new Error("no streams page");
		const { families, objects } = pageContent(page);
		const endpoints = families.reduce((n, f) => n + f.endpoints.length, 0);
		const html = await render(<ApiPage slug="streams" />);
		expect(count(html, 'class="apiref-prompt-bar"')).toBe(
			endpoints + objects.length,
		);
		expect(html).not.toContain("Task:");
	});

	test("the copy icon sits beside every endpoint path", async () => {
		const page = findApiPage("streams");
		if (!page) throw new Error("no streams page");
		const endpoints = pageContent(page).families.reduce(
			(n, f) => n + f.endpoints.length,
			0,
		);
		const html = await render(<ApiPage slug="streams" />);
		expect(count(html, 'class="apiref-copy-url"')).toBe(endpoints);
	});
});
