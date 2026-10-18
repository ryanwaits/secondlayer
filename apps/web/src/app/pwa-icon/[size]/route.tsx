import { ImageResponse } from "next/og";
import { drawIcon } from "../draw";

export const dynamic = "force-static";

const SIZES = [192, 512] as const;

export function generateStaticParams() {
	return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ size: string }> },
) {
	const { size } = await params;
	const px = SIZES.find((s) => String(s) === size);
	if (!px) return new Response("Not found", { status: 404 });
	return new ImageResponse(drawIcon(px), { width: px, height: px });
}
