"use client";

import { Liveline, type LivelinePoint } from "liveline";
import { useEffect, useState } from "react";

/** Liveline draws every text label itself, in a hardcoded canvas font it
 *  doesn't expose a prop for (`11px "SF Mono", Menlo, ...` — see its
 *  `palette.labelFont`). We never ship a library's own font or palette, so
 *  every prop that would paint text is switched off or fed a formatter that
 *  returns "": grid off, badge off, showValue off, scrub off, time/value
 *  formatters blank, empty-state text blank. What's left is pure geometry —
 *  the line and its live dot — colored with our own `--fig-role-a`. Every
 *  label around the chart (title, "live" marker, waiting count, axis times)
 *  is ordinary DOM text in our tokens, laid out by the caller. */

function useResolvedCssColor(variable: string): string {
	const [color, setColor] = useState("");
	useEffect(() => {
		const read = () =>
			setColor(
				getComputedStyle(document.documentElement)
					.getPropertyValue(variable)
					.trim(),
			);
		read();
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		mq.addEventListener("change", read);
		return () => mq.removeEventListener("change", read);
	}, [variable]);
	return color;
}

function usePageTheme(): "light" | "dark" {
	const [dark, setDark] = useState(false);
	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		setDark(mq.matches);
		const onChange = () => setDark(mq.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);
	return dark ? "dark" : "light";
}

const noText = () => "";

/** Events waiting since the last success, live. `data` is seeded on mount
 *  from `/activity`'s hourly history (so the rise shows on first paint), then
 *  grows with this session's live polls while `receiver_down` stays primary.
 *  `windowSecs` must cover that whole span — Liveline's own `window` prop
 *  defaults to 30s, which would clip the seeded history and show only a
 *  flat tail. */
export function LivelineWaitingChart({
	data,
	value,
	windowSecs,
	height = 70,
}: {
	data: LivelinePoint[];
	value: number;
	windowSecs: number;
	height?: number;
}) {
	const color = useResolvedCssColor("--fig-role-a");
	const theme = usePageTheme();

	if (!color) return <div style={{ height }} />;

	return (
		<div style={{ height }}>
			<Liveline
				data={data}
				value={value}
				window={windowSecs}
				color={color}
				theme={theme}
				grid={false}
				badge={false}
				showValue={false}
				scrub={false}
				momentum={false}
				degen={false}
				fill
				pulse
				formatTime={noText}
				formatValue={noText}
				emptyText=""
				padding={{ top: 6, right: 6, bottom: 6, left: 6 }}
			/>
		</div>
	);
}
