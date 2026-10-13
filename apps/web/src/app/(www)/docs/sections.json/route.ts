import { docsSectionList } from "@/lib/docs-source";

/** Every docs page and section with a one-line summary, for the API's search finder. */
export const dynamic = "force-static";

export async function GET() {
	return Response.json(await docsSectionList(), {
		headers: { "Cache-Control": "public, max-age=600" },
	});
}
