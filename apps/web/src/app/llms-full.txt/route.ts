import { readAllDocsMarkdown } from "@/lib/docs-source";

/** Sidebar groups that are guides; the generated references are listed in `llms-api.txt` and per-page `.md`. */
const GUIDE_GROUPS = ["Start", "Products", "Tools"];

/** The one reference page agents need to use any endpoint: envelope, cursors, filters, SSE. */
const REST_CONVENTIONS = "/docs/rest-api";

/**
 * The guides as one markdown file — the `llms-full.txt` convention.
 * `llms.txt` is the index an agent reads to orient; this is the corpus it reads
 * to actually answer, without crawling HTML pages and stripping chrome.
 *
 * Guides (Start, Products, Tools) plus the REST conventions page, which is the
 * only home of the response envelope, cursors and the SSE contract. The API and
 * SDK references and the changelog are generated and huge, so they stay out and
 * fetchers don't truncate the guides. Endpoints are listed in `llms-api.txt`; any page is
 * available alone by appending `.md`.
 *
 * Generated from the MDX at request time and cached, so it can never drift from
 * the pages it mirrors.
 */
export const revalidate = 3600;

export async function GET() {
	const body = await readAllDocsMarkdown(
		(page) =>
			GUIDE_GROUPS.includes(page.group) || page.href === REST_CONVENTIONS,
	);
	return new Response(
		`# secondlayer docs: guides\n\n> Every guide at https://www.secondlayer.tools/docs, in sidebar order. API and SDK references and the changelog are not included.\n> Endpoints, one markdown URL each: https://www.secondlayer.tools/llms-api.txt\n> Index: https://www.secondlayer.tools/llms.txt\n\n${body}\n`,
		{
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		},
	);
}
