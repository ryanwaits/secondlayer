"use client";

import NumberFlow from "@number-flow/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Big figure with a caption. SSR renders the final number; on mount it
 * snaps to just below and rolls up once. Later value changes (live counts)
 * roll from the current figure. NumberFlow skips the motion for
 * prefers-reduced-motion, and we skip the snap-down in that case.
 */
export function Odometer({
	value,
	label,
}: { value: number; label: ReactNode }) {
	const [shown, setShown] = useState(value);
	const [animated, setAnimated] = useState(true);
	const mounted = useRef(false);

	useEffect(() => {
		if (mounted.current) {
			setShown(value);
			return;
		}
		mounted.current = true;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		setAnimated(false);
		setShown(Math.floor(value * 0.994));
		const id = requestAnimationFrame(() => {
			setAnimated(true);
			setShown(value);
		});
		return () => cancelAnimationFrame(id);
	}, [value]);

	return (
		<div className="odo">
			<span className="odo-n">
				<NumberFlow
					value={shown}
					animated={animated}
					format={{ useGrouping: true }}
					locales="en-US"
				/>
			</span>
			<span className="cap">{label}</span>
		</div>
	);
}
