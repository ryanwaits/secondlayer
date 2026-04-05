"use client";

interface SuccessBannerProps {
	message: string;
}

export function SuccessBanner({ message }: SuccessBannerProps) {
	return (
		<div className="tool-success-banner">
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			>
				<circle cx="8" cy="8" r="6" />
				<path d="M5.5 8l2 2 3.5-3.5" />
			</svg>
			{message}
		</div>
	);
}
