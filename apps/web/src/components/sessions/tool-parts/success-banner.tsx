"use client";

interface SuccessBannerProps {
	message: string;
	tone?: "success" | "error" | "info";
}

export function SuccessBanner({
	message,
	tone = "success",
}: SuccessBannerProps) {
	return (
		<div className={`tool-success-banner tone-${tone}`}>
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
				{tone === "error" ? (
					<>
						<path d="M10 6l-4 4" />
						<path d="M6 6l4 4" />
					</>
				) : tone === "info" ? (
					<>
						<path d="M8 11V7" />
						<circle cx="8" cy="5" r="0.5" fill="currentColor" />
					</>
				) : (
					<path d="M5.5 8l2 2 3.5-3.5" />
				)}
			</svg>
			{message}
		</div>
	);
}
