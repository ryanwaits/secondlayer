import type { CSSProperties } from "react";

/** A single placeholder bar used to build loading skeletons. */
export function SkeletonBar({
	width,
	height = 12,
	radius = 3,
	style,
}: {
	width: number | string;
	height?: number | string;
	radius?: number;
	style?: CSSProperties;
}) {
	return (
		<span
			aria-hidden="true"
			className="sl-skeleton"
			style={{
				display: "inline-block",
				width,
				height,
				borderRadius: radius,
				...style,
			}}
		/>
	);
}
