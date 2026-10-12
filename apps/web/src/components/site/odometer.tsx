"use client";

import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";

/**
 * Big figure with a caption. SSR renders the final number; on mount it
 * snaps to just below and rolls up. NumberFlow also skips the motion for
 * prefers-reduced-motion, and we skip the snap-down in that case.
 */
export function Odometer({ value, label }: { value: number; label: string }) {
	const [shown, setShown] = useState(value);
	const [animated, setAnimated] = useState(true);

	useEffect(() => {
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
