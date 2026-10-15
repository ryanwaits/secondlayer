import { describe, expect, test } from "bun:test";
import { Fork, ForkPath } from "@/components/docs/fork";
import { Seam } from "@/components/docs/seam";
import { Stack } from "@/components/docs/stack";
import { Yields } from "@/components/docs/yields";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";

/** Render a tree that holds async server components to markup, as the build does. */
async function render(element: ReactElement): Promise<string> {
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}

describe("the stack", () => {
	test("the stack lists products from webhooks down to archive, then verify", async () => {
		const html = await render(<Stack />);
		const hrefs = [...html.matchAll(/data-href="([^"]+)"/g)].map((m) => m[1]);
		expect(hrefs).toEqual([
			"/docs/webhooks",
			"/docs/subgraphs",
			"/docs/index",
			"/docs/streams",
			"/docs/archive",
		]);
		expect(html.indexOf("/docs/archive")).toBeLessThan(
			html.indexOf("/docs/verification"),
		);
	});
});

describe("the seam", () => {
	test("the seam links one layer down and one up, and edges say where the stack ends", async () => {
		const middle = await render(<Seam page="index" />);
		expect(middle).toContain('href="/docs/streams"');
		expect(middle).toContain('href="/docs/subgraphs"');
		expect(middle).toContain("One layer down");
		expect(middle).toContain("One layer up");

		const bottom = await render(<Seam page="archive" />);
		expect(bottom).toContain("Bottom layer");
		expect(bottom).toContain('href="/docs/streams"');

		const top = await render(<Seam page="webhooks" />);
		expect(top).toContain("Top layer");
		expect(top).toContain('href="/docs/deploy"');
	});

	test("the seam marks where reference sections start", async () => {
		const html = await render(<Seam page="streams" />);
		expect(html).toContain("data-outline-reference");
	});
});

describe("start pages", () => {
	test("start pages show their own get/write labels", async () => {
		const html = await render(<Yields page="keys" />);
		expect(html).toContain("You get");
		expect(html).toContain("You set");
		expect(html).not.toContain("You write");
	});

	test("a start page's seam links its two next pages", async () => {
		const html = await render(<Seam page="selfhost" />);
		expect(html).toContain('href="/docs/verification"');
		expect(html).toContain('href="/docs/authentication"');
		expect(html).toContain("data-outline-reference");
	});
});

describe("the fork", () => {
	test("the fork checks its first path and renders every path", async () => {
		const html = await render(
			<Fork question="Do you have an API?" name="api">
				<ForkPath value="index" label="Yes">
					<p>keep your schema</p>
				</ForkPath>
				<ForkPath value="subgraphs" label="No">
					<p>get a table</p>
				</ForkPath>
			</Fork>,
		);
		const checked = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
		expect(checked).toHaveLength(2);
		expect(checked[0]).toContain('checked=""');
		expect(checked[1]).not.toContain('checked=""');
		expect(html).toContain('data-path="index"');
		expect(html).toContain('data-path="subgraphs"');
		expect(html).toContain("keep your schema");
		expect(html).toContain("get a table");
	});
});
