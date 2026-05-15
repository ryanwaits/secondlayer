import { OG_CONTENT_TYPE, OG_SIZE, OgCard } from "@/components/og-card";
import { ImageResponse } from "next/og";

export const alt = "BNS dataset — secondlayer";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
	return new ImageResponse(
		(
			<OgCard
				title="BNS"
				tagline="Stacks BNS-V2 names, namespaces, and marketplace events — decoded, queryable."
				endpoint="/v1/datasets/bns/names"
			/>
		),
		{ ...size },
	);
}
