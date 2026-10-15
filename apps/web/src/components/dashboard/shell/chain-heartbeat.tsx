"use client";

import { staleness, useChainTip } from "@/lib/chain-tip";
import { useEffect, useState } from "react";

export function HeartbeatView({
	height,
	seenAt,
	avgBlockSec,
	beat,
	now,
}: {
	height: number | null;
	seenAt: number | null;
	avgBlockSec: number | null;
	beat: number;
	now: number;
}) {
	if (height === null) return null;
	const { ageSec, level } = staleness(
		{ height, seenAt, intervals: [], avgBlockSec, beat },
		now,
	);
	const dot =
		level === "down"
			? "dash-dot alarm"
			: level === "stale"
				? "dash-dot hi"
				: beat > 0
					? "dash-dot pulse"
					: "dash-dot";
	const usually =
		avgBlockSec !== null ? ` · usually every ${Math.round(avgBlockSec)}s` : "";
	const title = `Last block ${ageSec}s ago${usually}`;
	return (
		<span className="dash-beat" title={title}>
			{/* key={beat} remounts the dot on every new block, restarting the pulse. */}
			<span key={beat} className={dot} />
			<span className="dash-beat-lbl">Stacks</span>
			<b>#{height.toLocaleString("en-US")}</b>
			{level !== "fresh" ? (
				<span>no block for {Math.floor(ageSec / 60)}m</span>
			) : null}
		</span>
	);
}

/** The chain heartbeat: pulses once per new Stacks block, prints age only when stale. */
export function ChainHeartbeat() {
	const tip = useChainTip();
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(id);
	}, []);
	return <HeartbeatView {...tip} now={now} />;
}
