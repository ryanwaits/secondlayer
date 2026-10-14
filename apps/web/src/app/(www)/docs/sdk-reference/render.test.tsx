import { describe, expect, test } from "bun:test";
import { Code } from "@/components/code/code";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { PACKAGE_PAGES, SDK_BASE, SDK_SURFACES } from "./pages";
import { manifest } from "./reference";
import {
	PackageReferencePage,
	SdkErrorsPage,
	SdkHelpersPage,
	SdkOverview,
	SdkSurfacePage,
} from "./sdk-reference";

/** Render a tree that holds async server components to markup, as the build does. */
async function render(element: ReactElement): Promise<string> {
	const stream = await renderToReadableStream(element);
	await stream.allReady;
	return new Response(stream).text();
}

const ids = (html: string) =>
	[...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] as string);

describe("a surface page", () => {
	test("every surface renders, with unique anchors and no leaked annotations", async () => {
		for (const s of SDK_SURFACES) {
			const html = await render(<SdkSurfacePage slug={s.slug} />);
			const all = ids(html);
			const dupes = all.filter((id, i) => all.indexOf(id) !== i);
			expect(dupes, `${s.slug}: duplicate ids`).toEqual([]);
			expect(html, s.slug).not.toContain("!ref");
			expect(html, s.slug).not.toContain("!callout");
		}
	});

	test("a method's parameter rows are mentions of refs in its signature and example", async () => {
		const html = await render(<SdkSurfacePage slug="streams" />);
		const start = html.indexOf('id="m-events-consume"');
		const entry = html.slice(start, html.indexOf('id="m-events-replay"'));
		expect(entry).toContain("data-scope");
		// The row, the signature's token and the example's token share a name.
		expect(entry).toContain('data-hover="onBatch"');
		expect(entry).toContain('<span class="ref" data-ref="onBatch">');
		expect(entry).toContain('data-hover="sink"');
		expect(entry).toContain('<span class="ref" data-ref="sink">');
		// The method's own path in its signature is a ref, so it never links to itself.
		expect(entry).toContain('<span class="ref" data-ref="method">');
		const signatures = entry.slice(0, entry.indexOf("bun:sqlite"));
		expect(signatures).not.toContain(
			'class="lk" href="/docs/sdk-reference/streams#m-events-consume"',
		);
	});

	test("overloads are tabs with distinct labels", async () => {
		const html = await render(<SdkSurfacePage slug="streams" />);
		const list = html.slice(
			html.indexOf('id="m-events-list"'),
			html.indexOf('id="m-events-byTxId"'),
		);
		const tabs = [...list.matchAll(/data-tab="([^"]+)">[^<]+<\/button>/g)].map(
			(m) => m[1],
		);
		expect(tabs.length).toBeGreaterThan(1);
		expect(new Set(tabs).size).toBe(tabs.length);
	});

	test("the glance table carries what the filter searches", async () => {
		const html = await render(<SdkSurfacePage slug="streams" />);
		expect(html).toContain('data-q="sl.streams.events.consume ');
		expect(html).toContain('placeholder="Filter ');
	});

	test("a method with a REST twin links its endpoint and pairs its example with cURL", async () => {
		const html = await render(<SdkSurfacePage slug="webhooks" />);
		expect(html).toContain('href="/docs/api/webhooks#');
	});

	test("the client page opens with the constructor, its options documented", async () => {
		const html = await render(<SdkSurfacePage slug="client" />);
		const ctor = html.indexOf('id="m-SecondLayer"');
		expect(ctor).toBeGreaterThan(-1);
		expect(ctor).toBeLessThan(html.indexOf('id="m-batch"'));
		const entry = html.slice(ctor, html.indexOf('id="m-batch"'));
		expect(entry).toContain("new ");
		expect(entry).toContain('data-hover="baseUrl"');
		expect(entry).toContain("Base URL of the instance API");
		// A constructor's signature does not end in a return type.
		expect(entry).not.toContain("): SecondLayer");
	});

	test("a void callback renders void, never null", async () => {
		const streams = await render(<SdkSurfacePage slug="streams" />);
		expect(streams).toContain("=&gt; void");
		expect(streams).not.toContain("=&gt; null");
	});
});

describe("the reference's own links", () => {
	test("a block naming a reference type tips it, and the tip knows its entry", async () => {
		const html = renderBlock(
			await Code({
				lang: "ts",
				tips: ["ConsumerBatchContext"],
				code: "function onBatch(ctx: ConsumerBatchContext) {}",
			}),
		);
		expect(html).toContain('class="tip"');
		expect(html).toContain(
			"&quot;route&quot;:&quot;/docs/sdk-reference/streams&quot;",
		);
		expect(html).toContain(
			"&quot;anchor&quot;:&quot;t-ConsumerBatchContext&quot;",
		);
		expect(html).not.toContain("<a ");
	});

	test("a tip's entry is a row of the types list", async () => {
		const html = await render(<SdkSurfacePage slug="streams" />);
		expect(html).toContain('id="t-ConsumerBatchContext"');
	});
});

function renderBlock(element: ReactElement): string {
	// `Code` resolves to a sync element: its markup is one string.
	const props = element.props as {
		className: string;
		dangerouslySetInnerHTML: { __html: string };
	};
	return `<div class="${props.className}">${props.dangerouslySetInnerHTML.__html}</div>`;
}

describe("a function-first package page", () => {
	test("every package renders its groups, unique anchors and no leaked annotations", async () => {
		for (const p of PACKAGE_PAGES) {
			const html = await render(<PackageReferencePage pkg={p.key} />);
			const all = ids(html);
			const dupes = all.filter((id, i) => all.indexOf(id) !== i);
			expect(dupes, `${p.key}: duplicate ids`).toEqual([]);
			expect(html, p.key).not.toContain("!ref");
			expect(html, p.key).not.toContain("!callout");
			for (const g of manifest(p.key).surfaces)
				expect(html, `${p.key}/${g.slug}`).toContain(`id="g-${g.slug}"`);
		}
	});

	test("the glance filter counts functions and holds one table per group", async () => {
		const html = await render(<PackageReferencePage pkg="subgraphs" />);
		expect(html).toContain('placeholder="Filter 45 functions"');
		expect(html).toContain('class="sdkr-grow" data-group');
		expect(html).toContain('data-q="definesubgraph ');
	});

	test("a group names where its functions import from", async () => {
		const html = await render(<PackageReferencePage pkg="subgraphs" />);
		expect(html).toContain("@secondlayer/subgraphs/testing");
		expect(html).toContain("@secondlayer/subgraphs");
	});

	test("a class lists its constructor first, then its constants and types", async () => {
		const html = await render(<PackageReferencePage pkg="verify" />);
		const ctor = html.indexOf('id="m-SecondlayerProofSource"');
		expect(ctor).toBeGreaterThan(-1);
		expect(ctor).toBeLessThan(
			html.indexOf('id="m-SecondlayerProofSource-getBlock"'),
		);
		expect(html).toContain('id="c-DEFAULT_API_URL"');
		expect(html).toContain('id="t-BlockVerification"');
	});
});

describe("tips across packages", () => {
	const entry = (route: string, anchor: string) =>
		`&quot;route&quot;:&quot;${route}&quot;,&quot;anchor&quot;:&quot;${anchor}&quot;`;

	test("a subgraphs function tips with its entry on the package page", async () => {
		const html = renderBlock(
			await Code({
				lang: "ts",
				tips: ["defineSubgraph"],
				code: "export default defineSubgraph({ name: 'x' });",
			}),
		);
		expect(html).toContain('class="tip"');
		expect(html).toContain(
			entry("/docs/subgraphs-reference", "m-defineSubgraph"),
		);
	});

	test("a filters builder tips the same way", async () => {
		const filters = renderBlock(
			await Code({
				lang: "ts",
				tips: ["on.ftTransfer"],
				code: "const f = on.ftTransfer({});",
			}),
		);
		expect(filters).toContain(
			entry("/docs/filters-reference", "m-on-ftTransfer"),
		);
	});
});

describe("the other pages", () => {
	test("overview lists every surface with its method count and the error tree", async () => {
		const html = await render(<SdkOverview />);
		for (const s of SDK_SURFACES)
			expect(html).toContain(`href="${SDK_BASE}/${s.slug}"`);
		expect(html).toContain("SecondLayerError");
		expect(html).toContain("sl.streams");
	});

	test("helpers and errors render their anchors", async () => {
		const helpers = await render(<SdkHelpersPage />);
		expect(helpers).toContain('id="h-verifyWebhookSignature"');
		const errors = await render(<SdkErrorsPage />);
		expect(errors).toContain('id="e-AuthError"');
		expect(errors).toContain('id="e-SecondLayerError"');
	});
});
