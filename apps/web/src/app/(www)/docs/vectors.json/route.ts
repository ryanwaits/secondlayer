import vectors from "@/generated/docs-vectors.json";

export const dynamic = "force-static";

export function GET() {
	return Response.json(vectors, {
		headers: { "Cache-Control": "public, max-age=600" },
	});
}
