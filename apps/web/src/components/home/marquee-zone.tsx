"use client";

import { type ReactNode, useRef } from "react";

/**
 * Hover wrapper for the protocol marquee. Slows the scroll to half speed while
 * the pointer is over the band and restores it on leave. Uses the Web
 * Animations API `playbackRate` rather than swapping CSS `animation-duration`:
 * changing the duration remaps the current time to a new progress fraction and
 * the track visibly jumps, whereas `playbackRate` keeps the position and only
 * changes how fast it advances — a seamless ease, no glitch.
 */
export function MarqueeZone({ children }: { children: ReactNode }) {
	const zoneRef = useRef<HTMLDivElement>(null);

	function setRate(rate: number) {
		const track = zoneRef.current?.querySelector(".home-marquee-track");
		const anims = (track as HTMLElement | null)?.getAnimations?.();
		if (!anims) return;
		for (const a of anims) {
			// updatePlaybackRate synchronizes position before changing speed
			if (typeof a.updatePlaybackRate === "function") {
				a.updatePlaybackRate(rate);
			} else {
				a.playbackRate = rate;
			}
		}
	}

	return (
		<div
			ref={zoneRef}
			className="home-marquee-zone"
			onMouseEnter={() => setRate(0.5)}
			onMouseLeave={() => setRate(1)}
		>
			{children}
		</div>
	);
}
