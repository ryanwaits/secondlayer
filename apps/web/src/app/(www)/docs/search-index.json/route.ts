import { docsSearchDocs } from "@/lib/docs-source";

export const dynamic = "force-static";

/** The docs search index, compiled at build time and ranked in the browser. */
export async function GET() {
	return Response.json(await docsSearchDocs());
}
