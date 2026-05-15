import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from "@/components/og-card";
import { ImageResponse } from "next/og";

export const alt = "STX Transfers dataset — secondlayer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
	return new ImageResponse(
		(
			<OgCard
				title="STX Transfers"
				tagline="Every canonical STX transfer on Stacks — sender, recipient, amount, memo."
				endpoint="/v1/datasets/stx-transfers"
			/>
		),
		{ ...size },
	);
}
