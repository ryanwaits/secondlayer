import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from "@/components/og-card";
import { ImageResponse } from "next/og";

export const alt = "PoX-4 / Stacking dataset — secondlayer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
	return new ImageResponse(
		<OgCard
			title="PoX-4"
			tagline="Every Stacks PoX-4 contract call decoded — stacking, delegation, signer auths."
			endpoint="/v1/datasets/pox-4/calls"
		/>,
		{ ...size },
	);
}
