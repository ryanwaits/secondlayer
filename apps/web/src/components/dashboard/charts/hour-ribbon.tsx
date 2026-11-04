"use client";

import { heatGrid, hourWindowLabel } from "@/lib/dashboard-charts";
import { useEffect, useMemo, useState } from "react";
import type { HeatUnits } from "./heat-strip";

const DEFAULT_UNITS: HeatUnits = { n: "delivered", f: "failed" };

/** A day label needs this many hours of room; a narrower day gets the tick only. */
const LABEL_MIN_HOURS = 8;

interface Hover {
	index: number;
	/** Viewport coordinates of the cell's top centre. */
	x: number;
	y: number;
}

/** The window's UTC days: where each starts (a column index) and how many of
 *  its hours the window holds. */
function windowDays(now: number) {
	return heatGrid([], now).days.flatMap((day) => {
		const first = day.cells.findIndex((cell) => cell !== null);
		const start = day.cells[first];
		if (!start) return [];
		return [
			{
				label: day.label,
				index: start.index,
				span: day.cells.filter((cell) => cell !== null).length,
				midnight: first === 0,
			},
		];
	});
}

/**
 * Seven days of hours as one continuous strip on the 168-hour UTC window, with
 * a faint tick at each midnight. Colour follows the heat strip (`f` is
 * `--alarm`, an empty hour `--soft`, else volume as opacity). Cells are not
 * clickable: the row around the ribbon is the target. Hover shows the hour.
 */
export function HourRibbon({
	hours,
	now,
	label,
	units = DEFAULT_UNITS,
	tone,
}: {
	/** Rolling window, index 0 = the hour 167 h before `now`. */
	hours: readonly { n: number; f: number }[];
	now: number;
	/** Accessible name for the strip. */
	label: string;
	units?: HeatUnits;
	/** The row this sits in is attention: delivered cells use `--hi`. */
	tone?: "att";
}) {
	const max = useMemo(() => Math.max(1, ...hours.map((c) => c.n)), [hours]);
	const midnights = useMemo(
		() =>
			new Set(
				windowDays(now)
					.filter((day) => day.midnight && day.index > 0)
					.map((day) => day.index),
			),
		[now],
	);
	const [hover, setHover] = useState<Hover | null>(null);

	useEffect(() => {
		if (!hover) return;
		const hide = () => setHover(null);
		window.addEventListener("scroll", hide, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", hide, { capture: true });
	}, [hover]);

	// Hover only changes the tooltip, so the 168 cells are reused.
	const cells = useMemo(
		() =>
			hours.map((cell, index) => {
				const cls = [
					"ix-cell",
					cell.f > 0 ? "f" : cell.n === 0 ? "z" : "",
					midnights.has(index) ? "mid" : "",
				]
					.filter(Boolean)
					.join(" ");
				const opacity = (0.25 + 0.75 * Math.sqrt(cell.n / max)).toFixed(2);
				return (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: hours are positional
						key={index}
						className={cls}
						style={{ opacity }}
						onPointerEnter={(e) => {
							const rect = e.currentTarget.getBoundingClientRect();
							setHover({
								index,
								x: rect.left + rect.width / 2,
								y: rect.top,
							});
						}}
						onPointerLeave={() => setHover(null)}
					/>
				);
			}),
		[hours, max, midnights],
	);

	const hovered = hover ? hours[hover.index] : undefined;
	return (
		<div className="ix-ribbon-wrap">
			<div
				className={tone === "att" ? "ix-strip att" : "ix-strip"}
				role="img"
				aria-label={label}
			>
				{cells}
			</div>
			{hover && hovered ? (
				<div
					className="dc-heat-tip"
					role="tooltip"
					style={{ left: hover.x, top: hover.y }}
				>
					<b>{hourWindowLabel(hover.index, now)}</b>
					<div>
						<span className="dc-tip-num">
							{hovered.n.toLocaleString("en-US")}
						</span>{" "}
						{units.n}
						{hovered.f > 0 ? (
							<>
								{" · "}
								<span className="dc-tip-fail">
									{hovered.f.toLocaleString("en-US")} {units.f}
								</span>
							</>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}

/** The ribbon's column header: a day label at each UTC midnight, on the same
 *  168 columns as the cells. The last says UTC once for all of them. */
export function RibbonDays({ now }: { now: number }) {
	const days = useMemo(() => windowDays(now), [now]);
	return (
		<div className="ix-days">
			{days
				.filter((day) => day.midnight)
				.map((day) => {
					const last = day.index + day.span >= 168;
					return (
						<span
							key={day.index}
							className="ix-day"
							style={{ gridColumn: `${day.index + 1} / span ${day.span}` }}
						>
							{day.span >= LABEL_MIN_HOURS
								? `${day.label}${last ? " · UTC" : ""}`
								: ""}
						</span>
					);
				})}
		</div>
	);
}
