import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from "@/components/og-card";
import { ImageResponse } from "next/og";

export const alt = "Network Health dataset — secondlayer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
	return new ImageResponse(
		(
			<OgCard
				title="Network Health"
				tagline="Daily rollups of Stacks block production, block-time, and reorgs."
				endpoint="/v1/datasets/network-health/summary"
			/>
		),
		{ ...size },
	);
}
