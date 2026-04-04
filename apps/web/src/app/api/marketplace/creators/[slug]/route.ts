import { ApiError, apiRequest } from "@/lib/api";
import { getMockCreator } from "@/lib/marketplace-mocks";
import { NextResponse } from "next/server";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug: string }> },
) {
	const { slug } = await params;

	try {
		const data = await apiRequest(`/api/marketplace/creators/${slug}`, {
			tags: ["marketplace"],
		});
		return NextResponse.json(data);
	} catch (e) {
		if (e instanceof ApiError && e.status === 404) {
			const mock = getMockCreator(slug);
			if (!mock) {
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			}
			return NextResponse.json(mock);
		}
		const mock = getMockCreator(slug);
		if (!mock) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
		return NextResponse.json(mock);
	}
}
