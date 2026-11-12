"use client";

import type { StripItem } from "@/lib/protocol-stats";
import { formatRelative } from "@/lib/webhooks-data";
import NumberFlow from "@number-flow/react";
import { useEffect, useState } from "react";

const REFRESH_MS = 15_000;

/**
 * "updated 12:00 UTC" on the server and first paint (deterministic, so it
 * hydrates cleanly), then a relative "42s ago" that keeps ticking.
 */
function Updated({ iso }: { iso: string }) {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
		return () => clearInterval(id);
	}, []);
	const clock = `${iso.slice(11, 16)} UTC`;
	return (
		<time dateTime={iso}>
			{now === null ? clock : formatRelative(iso, now)}
		</time>
	);
}

/** "As of Stacks block N · updated 1m ago": the block a live number is as of. */
export function LiveStamp({
	chain,
	blockHeight,
	generatedAt,
}: {
	chain: "Stacks" | "Bitcoin";
	blockHeight: number;
	generatedAt: string;
}) {
	return (
		<p className="live-meta cap">
			As of {chain} block {new Intl.NumberFormat("en-US").format(blockHeight)} ·
			updated <Updated iso={generatedAt} />
		</p>
	);
}

/** Four big numbers with one stamp line: the Stacks block they are as of. */
export function StatsStrip({
	items,
	sub,
	blockHeight,
	generatedAt,
}: {
	items: readonly StripItem[];
	sub: string | null;
	blockHeight: number;
	generatedAt: string;
}) {
	return (
		<div className="live-strip">
			{sub ? <p className="live-sub">{sub}</p> : null}
			<div className="live-stats">
				{items.map((item) => (
					<div key={item.label} className="live-stat">
						<p className="live-n">
							<NumberFlow
								value={item.value}
								locales="en-US"
								format={{
									useGrouping: true,
									minimumFractionDigits: item.decimals,
									maximumFractionDigits: item.decimals,
								}}
							/>
							{item.unit ? (
								<span className="live-unit">{item.unit}</span>
							) : null}
						</p>
						<p className="cap">{item.label}</p>
					</div>
				))}
			</div>
			<LiveStamp
				chain="Stacks"
				blockHeight={blockHeight}
				generatedAt={generatedAt}
			/>
		</div>
	);
}
