export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

type OgCardProps = {
	title: string;
	tagline: string;
	endpoint: string;
};

export function OgCard({ title, tagline, endpoint }: OgCardProps) {
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				background: "#fafafa",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: "72px 80px",
				fontFamily: "system-ui, -apple-system, sans-serif",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					color: "rgba(0, 0, 0, 0.45)",
					fontSize: 28,
					letterSpacing: "-0.01em",
				}}
			>
				secondlayer
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
				<div
					style={{
						color: "#111",
						fontSize: 112,
						fontWeight: 600,
						letterSpacing: "-0.03em",
						lineHeight: 1.0,
					}}
				>
					{title}
				</div>
				<div
					style={{
						color: "rgba(0, 0, 0, 0.6)",
						fontSize: 36,
						lineHeight: 1.3,
						maxWidth: 980,
					}}
				>
					{tagline}
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					color: "#ff00aa",
					fontSize: 28,
					fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				}}
			>
				<span>{endpoint}</span>
				<span style={{ color: "rgba(0, 0, 0, 0.35)" }}>Foundation Dataset</span>
			</div>
		</div>
	);
}
