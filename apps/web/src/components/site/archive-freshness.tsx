"use client";

import {
	type ArchiveFreshnessData,
	formatDay,
	formatPublishTime,
	overdueSince,
} from "@/lib/archive-freshness";
import { useChainTip } from "@/lib/chain-tip";
import NumberFlow from "@number-flow/react";

type Props = Omit<ArchiveFreshnessData, "promotedAt" | "state"> & {
	promotedAt: string | null;
	/** Archive state from status.json; "unknown" when the status couldn't be read. */
	state: string;
};

const flow = (v: number) => (
	<NumberFlow
		value={v}
		format={{ useGrouping: true }}
		locales="en-US"
		className="fresh-v"
	/>
);

/** The line under the Archive counter. `behind` is chain tip minus `toBlock`, null when unknown. */
export function ArchiveFreshnessView({
	toBlock,
	promotedAt,
	state,
	nextPublishAt,
	behind,
}: Omit<Props, "behindTip"> & { behind: number | null }) {
	const signed = (
		<>
			Signed through <b>#{toBlock.toLocaleString("en-US")}</b>
			{promotedAt ? <> on {formatDay(promotedAt)}</> : null}.
		</>
	);

	// gap, failed-audit, source-unavailable (or an unreadable status): the
	// "chain is N past it, next publish" story would mislead, so say only what
	// the signed copy reaches.
	if (state !== "fresh" && state !== "lagging" && state !== "stale")
		return <span className="fresh">{signed}</span>;

	const stale = state === "stale" && promotedAt;
	return (
		<span className="fresh">
			{signed}
			{behind !== null ? (
				<>
					{" "}
					The chain is <b>{flow(behind)}</b> blocks past it
				</>
			) : null}
			{stale ? (
				<>
					{behind !== null ? "; " : " "}
					<span className="fresh-dot" aria-hidden />
					<b>the next publish is overdue</b> since{" "}
					{formatDay(overdueSince(promotedAt))}.
				</>
			) : nextPublishAt ? (
				<>
					{behind !== null ? "; the" : " The"} next publish is{" "}
					<b>{formatPublishTime(nextPublishAt)}</b>.
				</>
			) : behind !== null ? (
				"."
			) : null}
		</span>
	);
}

/** Rolls with the live chain tip; SSR renders the server's figure so nothing shifts. */
export function ArchiveFreshness({ behindTip, ...rest }: Props) {
	const { height } = useChainTip();
	const behind =
		height === null ? behindTip : Math.max(0, height - rest.toBlock);
	return <ArchiveFreshnessView {...rest} behind={behind} />;
}
