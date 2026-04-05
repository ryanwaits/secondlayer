"use client";

interface ThinkingIndicatorProps {
	label?: string;
}

export function ThinkingIndicator({
	label = "Thinking...",
}: ThinkingIndicatorProps) {
	return (
		<div className="thinking">
			<div className="thinking-dots">
				<span />
				<span />
				<span />
			</div>
			{label}
		</div>
	);
}
