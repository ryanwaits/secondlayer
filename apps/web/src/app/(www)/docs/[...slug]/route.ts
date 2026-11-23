import {
	allEndpoints,
	endpointMarkdown,
	objectMarkdown,
	objectsByTag,
} from "@/app/(www)/docs/api-reference/spec";
import { SITE } from "@/lib/docs-agent";
import { docsPages, readDocsMarkdown } from "@/lib/docs-source";

function apiReferenceSection(anchor: string): string | null {
	const endpoint = allEndpoints().find((e) => e.anchor === anchor);
	if (endpoint) return endpointMarkdown(endpoint);
	for (const entries of objectsByTag().values()) {
		const entry = entries.find((o) => o.anchor === anchor);
		if (entry) return objectMarkdown(entry);
	}
	return null;
}

export const dynamicParams = false;

export function generateStaticParams() {
	const pages = docsPages().map((page) => ({
		slug: `${page.href.replace(/^\/docs\/?/, "") || "introduction"}.md`.split(
			"/",
		),
	}));
	const sections = [
		...allEndpoints().map((e) => e.anchor),
		...[...objectsByTag().values()].flat().map((o) => o.anchor),
	].map((anchor) => ({ slug: ["api-reference", `${anchor}.md`] }));
	return [...pages, ...sections];
}

export async function GET(
	_request: Request,
	context: { params: Promise<{ slug: string[] }> },
) {
	const { slug } = await context.params;
	const path = slug.join("/");
	if (!path.endsWith(".md")) {
		return new Response("Not found", { status: 404 });
	}

	const bare = path.slice(0, -3);
	if (bare.startsWith("api-reference/")) {
		const anchor = bare.slice("api-reference/".length);
		const section = apiReferenceSection(anchor);
		if (section === null) return new Response("Not found", { status: 404 });
		return new Response(
			`<!-- source: https://www.secondlayer.tools/docs/api-reference#${anchor} -->\n\n${section}\n`,
			{
				headers: {
					"Content-Type": "text/markdown; charset=utf-8",
					"Cache-Control": "public, max-age=3600",
					Link: `<${SITE}/docs/api-reference#${anchor}>; rel="canonical"`,
				},
			},
		);
	}
	// The introduction (`/docs`) has no slug of its own, so it serves as
	// `introduction.md`; `index.md` is the Index product page, as the
	// append-.md contract promises.
	const href = bare === "introduction" ? "/docs" : `/docs/${bare}`;
	const markdown = await readDocsMarkdown(href);
	if (markdown === null) {
		return new Response("Not found", { status: 404 });
	}

	return new Response(
		`<!-- source: https://www.secondlayer.tools${href} -->\n\n${markdown}\n`,
		{
			headers: {
				"Content-Type": "text/markdown; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
				Link: `<${SITE}${href}>; rel="canonical"`,
			},
		},
	);
}
