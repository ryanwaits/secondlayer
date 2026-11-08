"use client";

import { CheckIcon, CopyIcon } from "@/components/copy-button";
import { Mark } from "@/components/dashboard/shell/mark";
import { formatAge, formatDateTime } from "@/lib/account-data";
import { useCopied } from "@/lib/use-copied";
import type { ReactNode } from "react";

/** The quiet line under a detail page's name: what the resource is and when
 *  it was made. Items are separated by middots. */
export function MetaLine({ children }: { children: ReactNode }) {
	return <p className="wd-meta">{children}</p>;
}

/** A meta item that copies its full value, e.g. the contract behind a short
 *  name or a receiver URL behind its host. */
export function MetaCopy({
	label,
	shown,
	full,
	mark,
}: {
	/** What gets copied, for the button's label: "contract", "receiver URL". */
	label: string;
	shown: string;
	full: string;
	mark?: "att";
}) {
	const { copied, copy } = useCopied();
	return (
		<span>
			<span className="wd-meta-v" title={full}>
				{mark ? <Mark tone={mark}>{shown}</Mark> : shown}
			</span>
			<button
				type="button"
				className="wd-meta-copy"
				aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
				onClick={() => void copy(full)}
			>
				{copied ? <CheckIcon /> : <CopyIcon />}
			</button>
		</span>
	);
}

/** "Created 5 days ago", the exact time on hover or focus. */
export function CreatedAgo({ iso }: { iso: string }) {
	const exact = formatDateTime(iso);
	return (
		<span>
			Created{" "}
			<time
				className="wd-meta-v wd-tip"
				dateTime={iso}
				data-tip={exact}
				aria-label={`Created ${exact}`}
				// biome-ignore lint/a11y/noNoninteractiveTabindex: focus shows the exact time
				tabIndex={0}
				// The server and the browser read the clock moments apart.
				suppressHydrationWarning
			>
				{formatAge(iso)}
			</time>
		</span>
	);
}

/** One health number. Zero reads quiet; a value that is wrong gets a mark. */
export function Stat({
	label,
	value,
	unit,
	caption,
	zero = false,
	mark,
}: {
	label: string;
	value: string;
	unit?: string;
	caption?: string;
	zero?: boolean;
	mark?: "att" | "fail";
}) {
	return (
		<div>
			{label}
			<b className={zero ? "zero" : undefined}>
				{mark ? <Mark tone={mark}>{value}</Mark> : value}
				{unit ? <small>{unit}</small> : null}
			</b>
			{caption ? <span className="wd-stat-cap">{caption}</span> : null}
		</div>
	);
}

/** A reindex or catch-up: percent done, a bar, and the blocks still to go. */
export function ProgressStat({
	label,
	percent,
	caption,
	mark,
}: {
	label: string;
	percent: number | null;
	caption: string;
	mark?: "att";
}) {
	if (percent === null)
		return <Stat label={label} value={caption} mark={mark} />;
	const value = `${percent}%`;
	return (
		<div className="wd-stat-wide">
			{label}
			<b>{mark ? <Mark tone={mark}>{value}</Mark> : value}</b>
			{/* The percent above already says it; the bar is for the eye. */}
			<span className="wd-prog" aria-hidden="true">
				<i style={{ width: `${percent}%` }} />
			</span>
			<span className="wd-stat-cap">{caption}</span>
		</div>
	);
}
