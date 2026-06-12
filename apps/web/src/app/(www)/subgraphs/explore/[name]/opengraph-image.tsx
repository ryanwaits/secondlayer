import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PLATFORM_API_URL } from "@/lib/api";
import { ImageResponse } from "next/og";
import type { ExploreDetail } from "../types";

export const revalidate = 300;
export const alt = "Public subgraph on secondlayer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#111111";
const PAPER = "#fafafa";
const HAIRLINE = "#e5e5e5";
const MUTED = "rgba(0, 0, 0, 0.65)";
const ACCENT = "#2563eb";
const GREEN = "#22c55e";

const fmt = new Intl.NumberFormat("en-US");

async function fetchDetail(name: string): Promise<ExploreDetail | null> {
	try {
		const res = await fetch(`${PLATFORM_API_URL}/v1/subgraphs/${name}`, {
			next: { revalidate: 300 },
		});
		if (!res.ok) return null;
		return (await res.json()) as ExploreDetail;
	} catch {
		return null;
	}
}

export default async function Image({
	params,
}: {
	params: Promise<{ name: string }>;
}) {
	const { name } = await params;
	const [detail, sora, fira, firaMedium] = await Promise.all([
		fetchDetail(name),
		readFile(join(process.cwd(), "src/assets/og-fonts/Sora-SemiBold.ttf")),
		readFile(join(process.cwd(), "src/assets/og-fonts/FiraCode-Regular.ttf")),
		readFile(join(process.cwd(), "src/assets/og-fonts/FiraCode-Medium.ttf")),
	]);

	const tableCount = detail ? Object.keys(detail.tables).length : null;
	const synced = detail ? detail.tip.blocks_behind <= 2 : null;
	const height = detail ? detail.tip.subgraph_height : null;

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: PAPER,
				padding: "56px 80px 64px",
				fontFamily: "Fira Code",
				position: "relative",
			}}
		>
			<div
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: 1200,
					height: 630,
					background:
						"radial-gradient(circle at 88% 8%, rgba(37, 99, 235, 0.04), rgba(37, 99, 235, 0) 45%)",
				}}
			/>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					paddingBottom: 22,
					borderBottom: `1.5px solid ${HAIRLINE}`,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 13 }}>
					<svg
						viewBox="6 9 36 24"
						width="36"
						height="24"
						role="img"
						aria-label="secondlayer"
					>
						<polygon
							points="8,23 28,15 40,23 20,31"
							fill={ACCENT}
							opacity={0.24}
						/>
						<polygon points="8,19 28,11 40,19 20,27" fill={ACCENT} />
					</svg>
					<span
						style={{
							fontFamily: "Sora",
							fontSize: 27,
							fontWeight: 600,
							color: INK,
							letterSpacing: -0.4,
						}}
					>
						secondlayer
					</span>
				</div>
				<span
					style={{
						fontSize: 19,
						fontWeight: 500,
						letterSpacing: 1.5,
						textTransform: "uppercase",
						color: MUTED,
					}}
				>
					explore
				</span>
			</div>

			<div
				style={{
					flex: 1,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					gap: 30,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 28 }}>
					<span
						style={{
							fontSize: name.length > 18 ? 56 : 72,
							fontWeight: 500,
							color: INK,
							letterSpacing: -1.5,
						}}
					>
						{name}
					</span>
					{detail && (
						<span
							style={{
								fontSize: 22,
								fontWeight: 500,
								color: ACCENT,
								background: "rgba(37, 99, 235, 0.06)",
								border: "1.5px solid rgba(37, 99, 235, 0.2)",
								borderRadius: 6,
								padding: "6px 14px",
							}}
						>
							v{detail.version}
						</span>
					)}
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 18,
						fontSize: 22,
						color: MUTED,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<div
							style={{
								width: 9,
								height: 9,
								borderRadius: 999,
								background: synced === false ? "#eab308" : GREEN,
							}}
						/>
						<span style={{ color: synced === false ? "#eab308" : GREEN }}>
							{synced === false ? "syncing" : "synced"}
						</span>
					</div>
					{tableCount !== null && (
						<span>{`· ${tableCount} ${tableCount === 1 ? "table" : "tables"}`}</span>
					)}
					{height !== null && <span>{`· block #${fmt.format(height)}`}</span>}
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 12,
						fontSize: 23,
						background: "#ffffff",
						border: `1.5px solid ${HAIRLINE}`,
						borderRadius: 8,
						padding: "12px 20px",
						alignSelf: "flex-start",
					}}
				>
					<span style={{ color: ACCENT, fontWeight: 500 }}>GET</span>
					<span style={{ color: INK }}>{`/v1/subgraphs/${name}`}</span>
				</div>
			</div>
		</div>,
		{
			...size,
			fonts: [
				{ name: "Sora", data: sora, weight: 600, style: "normal" },
				{ name: "Fira Code", data: fira, weight: 400, style: "normal" },
				{ name: "Fira Code", data: firaMedium, weight: 500, style: "normal" },
			],
		},
	);
}
