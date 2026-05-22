import type { ReactNode } from "react";

interface InfoTooltipProps {
	/** Text shown in the bubble and exposed to assistive tech as the trigger's label. */
	text: string;
	/** Custom trigger content; defaults to the (i) info glyph. */
	children?: ReactNode;
	className?: string;
}

/**
 * Small (i) trigger that reveals a styled tooltip on hover and keyboard focus —
 * the LiveKit-style replacement for a native `title` attribute.
 *
 * CSS-only reveal (`:hover` / `:focus-within`), so it ships no client JS. The
 * bubble is positioned absolutely below the trigger; avoid placing it inside an
 * `overflow: hidden` or `opacity < 1` ancestor, which would clip or fade it.
 */
export function InfoTooltip({ text, children, className }: InfoTooltipProps) {
	return (
		<span className={`info-tip${className ? ` ${className}` : ""}`}>
			<button type="button" className="info-tip-trigger" aria-label={text}>
				{children ?? (
					<svg
						width="11"
						height="11"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<circle cx="8" cy="8" r="6" />
						<path d="M8 7v4" />
						<circle cx="8" cy="5" r="0.5" fill="currentColor" />
					</svg>
				)}
			</button>
			<span className="info-tip-bubble" role="tooltip">
				{text}
			</span>
		</span>
	);
}
