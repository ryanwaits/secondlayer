"use client";

import { useEffect, useState } from "react";
import { Insight } from "./insight";

const POLL_INTERVAL = 15_000;
const STALLED_THRESHOLD = 50;

interface StalledBannerProps {
	subgraphName: string;
	initialBlocksBehind: number;
	initialChainTip: number;
	initialLastProcessed: number;
}

export function StalledBanner({
	subgraphName,
	initialBlocksBehind,
	initialChainTip,
	initialLastProcessed,
}: StalledBannerProps) {
	const [blocksBehind, setBlocksBehind] = useState(initialBlocksBehind);
	const [chainTip, setChainTip] = useState(initialChainTip);
	const [lastProcessed, setLastProcessed] = useState(initialLastProcessed);

	useEffect(() => {
		const poll = async () => {
			try {
				const [subRes, statusRes] = await Promise.all([
					fetch(`/api/subgraphs/${subgraphName}`, {
						credentials: "same-origin",
					}),
					fetch("/api/status", { credentials: "same-origin" }),
				]);
				if (!subRes.ok || !statusRes.ok) return;

				const sub = await subRes.json();
				const status = await statusRes.json();

				const tip = status.chainTip ?? chainTip;
				const last = sub.lastProcessedBlock ?? lastProcessed;
				const behind = tip - last;

				setChainTip(tip);
				setLastProcessed(last);
				setBlocksBehind(behind);
			} catch {}
		};

		const id = setInterval(poll, POLL_INTERVAL);
		return () => clearInterval(id);
	}, [subgraphName, chainTip, lastProcessed]);

	if (blocksBehind <= STALLED_THRESHOLD) return null;

	return (
		<Insight variant="warning" id={`stalled-${subgraphName}`}>
			This subgraph is <strong>{blocksBehind.toLocaleString()} blocks</strong>{" "}
			behind the chain tip (#{chainTip.toLocaleString()}). Last processed: #
			{lastProcessed.toLocaleString()}.
		</Insight>
	);
}
