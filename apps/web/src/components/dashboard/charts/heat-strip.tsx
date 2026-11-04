"use client";

import {
	type HeatCell,
	heatGrid,
	hourWindowLabel,
} from "@/lib/dashboard-charts";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Hover {
	cell: HeatCell;
	/** Viewport coordinates of the cell's top centre. */
	x: number;
	y: number;
}

export interface HeatUnits {
	n: string;
	f: string;
}

const DEFAULT_UNITS: HeatUnits = { n: "delivered", f: "failed" };

/**
 * Seven days of deliveries as an hour-by-day grid, laid on UTC calendar days.
 * Cell opacity follows volume, `--alarm` marks hours with failures, and an
 * empty hour is `--soft`. Hover or focus shows a tooltip; click reports the
 * hour index so a screen can list that hour's deliveries. Without
 * `onCellClick`, a click passes to whatever the strip sits in.
 */
export function HeatStrip({
	hours,
	now,
	onCellClick,
	label,
	units = DEFAULT_UNITS,
	tone,
	hourAxis = true,
}: {
	/** Rolling window, index 0 = the hour 167 h before `now`. */
	hours: readonly { n: number; f: number }[];
	now: number;
	onCellClick?: (hourIndex: number) => void;
	/** Accessible name for the grid. */
	label: string;
	/** What a cell counts, for its label and tooltip: `n` for the volume,
	 *  `f` for the failures. */
	units?: HeatUnits;
	/** The row this sits in is attention: delivered cells use `--hi`; failed cells stay `--alarm`. */
	tone?: "att";
	/** The 00/06/12/18 labels under the grid. A list of strips shows them once, under the last. */
	hourAxis?: boolean;
}) {
	const { days } = useMemo(() => heatGrid(hours, now), [hours, now]);
	const max = useMemo(() => Math.max(1, ...hours.map((c) => c.n)), [hours]);
	const labels = useMemo(
		() =>
			Array.from({ length: hours.length }, (_, i) => hourWindowLabel(i, now)),
		[hours.length, now],
	);
	const [hover, setHover] = useState<Hover | null>(null);

	useEffect(() => {
		if (!hover) return;
		const hide = () => setHover(null);
		window.addEventListener("scroll", hide, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", hide, { capture: true });
	}, [hover]);

	const show = useCallback((cell: HeatCell, el: HTMLElement) => {
		const rect = el.getBoundingClientRect();
		setHover({ cell, x: rect.left + rect.width / 2, y: rect.top });
	}, []);

	// Hover only changes the tooltip, so the 168-cell grid is reused.
	const grid = useMemo(
		() => (
			<section className="dc-heat" aria-label={label}>
				{days.map((day) => (
					<HeatRow key={day.label}>
						<span className="dc-heat-day">{day.label}</span>
						{day.cells.map((cell, hr) => {
							if (!cell) {
								return (
									<span
										// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
										key={`blank-${hr}`}
										className="dc-heat-cell x"
										aria-hidden="true"
									/>
								);
							}
							const { n, f, index } = cell;
							const when = labels[index];
							const cls = f > 0 ? "f" : n === 0 ? "z" : "";
							const opacity = (0.25 + 0.75 * Math.sqrt(n / max)).toFixed(2);
							return (
								<button
									key={`hour-${index}`}
									type="button"
									className={`dc-heat-cell ${cls}`.trim()}
									style={{ opacity }}
									aria-label={`${when}, ${n} ${units.n}${f ? `, ${f} ${units.f}` : ""}`}
									onPointerEnter={(e) => show(cell, e.currentTarget)}
									onFocus={(e) => show(cell, e.currentTarget)}
									onPointerLeave={() => setHover(null)}
									onBlur={() => setHover(null)}
									onClick={(e) => {
										if (!onCellClick) return;
										// Handled here: a clickable row around the strip leaves it alone.
										e.preventDefault();
										onCellClick(index);
									}}
								/>
							);
						})}
					</HeatRow>
				))}
				{hourAxis ? <HourAxis /> : null}
			</section>
		),
		[days, labels, max, onCellClick, show, label, units, hourAxis],
	);

	return (
		<div className={tone === "att" ? "dc-heat-wrap att" : "dc-heat-wrap"}>
			{grid}
			{hover ? (
				<div
					className="dc-heat-tip"
					role="tooltip"
					style={{ left: hover.x, top: hover.y }}
				>
					<b>{labels[hover.cell.index]}</b>
					<div>
						<span className="dc-tip-num">
							{hover.cell.n.toLocaleString("en-US")}
						</span>{" "}
						{units.n}
						{hover.cell.f > 0 ? (
							<>
								{" · "}
								<span className="dc-tip-fail">
									{hover.cell.f.toLocaleString("en-US")} {units.f}
								</span>
							</>
						) : null}
					</div>
					{onCellClick && hover.cell.n + hover.cell.f > 0 ? (
						<div className="dc-tip-hint">Click for these deliveries</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** The 00/06/12/18 labels, on the grid's own columns. */
function HourAxis() {
	return (
		<HeatRow>
			<span />
			{Array.from({ length: 24 }, (_, hr) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
				<span key={hr} className="dc-heat-hour">
					{hr % 6 === 0 ? String(hr).padStart(2, "0") : ""}
				</span>
			))}
		</HeatRow>
	);
}

/** One grid row. `display: contents` keeps all rows on the one 25-column grid. */
function HeatRow({ children }: { children: React.ReactNode }) {
	return <div className="dc-heat-row">{children}</div>;
}

/** The strip's exact grid while its hours are still loading: same columns,
 *  same rows, shimmer-toned cells, so the real strip replaces it in place. */
export function HeatStripSkeleton({
	days = 8,
	hourAxis = true,
}: {
	days?: number;
	hourAxis?: boolean;
}) {
	return (
		<div className="dc-heat-wrap">
			<div className="dc-heat" aria-hidden="true">
				{Array.from({ length: days }, (_, d) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
					<HeatRow key={d}>
						<span className="dc-heat-day" />
						{Array.from({ length: 24 }, (_, hr) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
							<span key={hr} className="dc-heat-cell s" />
						))}
					</HeatRow>
				))}
				{hourAxis ? <HourAxis /> : null}
			</div>
		</div>
	);
}
