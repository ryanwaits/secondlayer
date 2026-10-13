import vectors from "@/generated/docs-vectors.json";

export const dynamic = "force-static";

/** Section vectors the API compares a search query against; built by `docs:vectors`. */
export function GET() {
	return Response.json(vectors, {
		headers: { "Cache-Control": "public, max-age=600" },
	});
}
