import type { ReactNode } from "react";
import { type Chain, MARKS } from "./chain-marks";

/**
 * A chain named inline in prose: its mark as a small chip, then the name,
 * underlined as a link. The chip and name never wrap apart. The shapes live
 * in `chain-marks.ts`; the colors come from `.chain-*` rules in site.css.
 */
export function ChainLink({
	chain,
	href,
	children,
}: {
	chain: Chain;
	/** Where the name leads. Without one, the chip and name read as plain text. */
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

/** A chain's mark alone, in its brand colors (the `.chain-*` rules in site.css). */
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
