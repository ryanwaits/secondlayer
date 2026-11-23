import type { ReactNode } from "react";
import { type Chain, MARKS } from "./chain-marks";

export function ChainLink({
	chain,
	href,
	children,
}: {
	chain: Chain;
	href?: string;
	children: ReactNode;
}) {
	const inner = (
		<>
			<ChainMark chain={chain} />
			<span className="chain-name">{children}</span>
		</>
	);
	return href ? (
		<a href={href} className="chain">
			{inner}
		</a>
	) : (
		<span className="chain chain-plain">{inner}</span>
	);
}

export function ChainMark({ chain }: { chain: Chain }) {
	const { size, shapes } = MARKS[chain];
	return (
		<span className={`chain-mark chain-${chain}`}>
			<svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
				{shapes.map((shape, i) =>
					"rx" in shape ? (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed shapes, never reordered
							key={i}
							width={size}
							height={size}
							rx={shape.rx}
							className={`chain-${shape.role}`}
						/>
					) : (
						<path
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed shapes, never reordered
							key={i}
							d={shape.d}
							transform={shape.transform}
							className={`chain-${shape.role}`}
							{...(shape.stroke
								? {
										fill: "none",
										strokeWidth: 9,
										strokeLinecap: "round" as const,
										strokeLinejoin: "round" as const,
									}
								: {})}
						/>
					),
				)}
			</svg>
		</span>
	);
}
