import { docsSearchDocs } from "@/lib/docs-source";

export const dynamic = "force-static";

export async function GET() {
	return Response.json(await docsSearchDocs());
}
