import { ApiError, apiRequest } from "@/lib/api";
import { getMockBrowse } from "@/lib/marketplace-mocks";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
	const { searchParams } = new URL(req.url);
	const qs = searchParams.toString();
	const path = `/api/marketplace/subgraphs${qs ? `?${qs}` : ""}`;

	try {
		const data = await apiRequest(path, { tags: ["marketplace"] });
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError && e.status !== 500) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		// Fallback to mock data when backend is unavailable
		return NextResponse.json(
			getMockBrowse({
				search: searchParams.get("search") ?? undefined,
				tags: searchParams.get("tags") ?? undefined,
				sort: searchParams.get("_sort") ?? undefined,
				limit: searchParams.has("_limit")
					? Number(searchParams.get("_limit"))
					: undefined,
				offset: searchParams.has("_offset")
					? Number(searchParams.get("_offset"))
					: undefined,
			}),
		);
	}
}
