import { readAllDocsMarkdown } from "@/lib/docs-source";

/**
 * The entire docs site as one markdown file — the `llms-full.txt` convention.
 * `llms.txt` is the index an agent reads to orient; this is the corpus it reads
 * to actually answer, without crawling 30 HTML pages and stripping chrome.
 *
 * Generated from the MDX at request time and cached, so it can never drift from
 * the pages it mirrors.
 */
export const revalidate = 3600;

export async function GET() {
	const body = await readAllDocsMarkdown();
	return new Response(
		`# Secondlayer docs — full text\n\n> Every page of https://secondlayer.tools/docs, in sidebar order.\n> Index: https://secondlayer.tools/llms.txt\n\n${body}\n`,
		{
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		},
	);
}
