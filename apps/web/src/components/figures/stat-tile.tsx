export type StatTileItem = {
	label: string;
	value: string;
	sub?: string;
	subTone?: "good";
	/** Optional word-scale spark under the value. */
	spark?: number[];
	sparkRole?: "a" | "b";
};

/**
 * A1 StatTile — one number IS the point. Tabular numerals, optional
 * spark with emphasized endpoint. Never three tiles saying the same thing.
 */
export function StatTile({ tiles }: { tiles: StatTileItem[] }) {
	return (
		<div className="fig-tiles">
			{tiles.map((tile) => (
				<div className="fig-tile" key={tile.label}>
					<div className="fig-tile-label">{tile.label}</div>
					<div className="fig-tile-value">{tile.value}</div>
					{tile.sub && (
						<div
							className={`fig-tile-sub${tile.subTone === "good" ? " good" : ""}`}
						>
							{tile.sub}
						</div>
					)}
					{tile.spark && (
						<TileSpark points={tile.spark} role={tile.sparkRole} />
					)}
				</div>
			))}
		</div>
	);
}

function TileSpark({
	points,
	role = "b",
}: {
	points: number[];
	role?: "a" | "b";
}) {
	const min = Math.min(...points);
	const range = Math.max(...points) - min || 1;
	const coords = points.map((p, i) => {
		const x = (i / (points.length - 1)) * 120;
		const y = 15 - ((p - min) / range) * 8;
		return [x, y] as const;
	});
	const last = coords[coords.length - 1];
	const color = role === "a" ? "var(--fig-role-a)" : "var(--fig-role-b)";
	return (
		<svg
			width="100%"
			height="18"
			viewBox="0 0 120 18"
			preserveAspectRatio="none"
			aria-hidden="true"
		>
			<polyline
				points={coords.map(([x, y]) => `${x},${y}`).join(" ")}
				fill="none"
				stroke={color}
				strokeWidth={1.5}
			/>
			<circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
		</svg>
	);
}
