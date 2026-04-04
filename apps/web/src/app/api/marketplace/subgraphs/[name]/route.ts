import { ApiError, apiRequest } from "@/lib/api";
import { getMockDetail } from "@/lib/marketplace-mocks";
import { NextResponse } from "next/server";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ name: string }> },
) {
	const { name } = await params;

	try {
		const data = await apiRequest(`/api/marketplace/subgraphs/${name}`, {
			tags: ["marketplace"],
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) {
			// Not found in real API — try mock
			const mock = getMockDetail(name);
			if (!mock) {
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			}
			return NextResponse.json(mock);
		}
		// Backend unavailable — fallback to mock
		const mock = getMockDetail(name);
		if (!mock) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json(mock);
	}
}
