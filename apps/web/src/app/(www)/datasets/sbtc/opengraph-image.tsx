import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from "@/components/og-card";
import { ImageResponse } from "next/og";

export const alt = "sBTC dataset — secondlayer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
	return new ImageResponse(
		(
			<OgCard
				title="sBTC"
				tagline="Every sBTC deposit, withdrawal, and SIP-010 movement on Stacks."
				endpoint="/v1/datasets/sbtc/events"
			/>
		),
		{ ...size },
	);
}
