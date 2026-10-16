"use client";

import { DayStrip } from "@/components/dashboard/charts/day-strip";
import { MemoryBand } from "@/components/dashboard/charts/memory-band";
import { Meter } from "@/components/dashboard/charts/meter";
import { InsightActions } from "@/components/dashboard/insight/insight-actions";
import { InsightCard } from "@/components/dashboard/insight/insight-card";
import { Skel } from "@/components/dashboard/shell/skel";
import { dotClass } from "@/components/dashboard/shell/status-sentence";
import { type Insight, autoOpenId, severityDot } from "@/lib/insights";
import type { RowsResponse } from "@/lib/rows";
import type { ApiKey } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	ROWS_ALLOWANCE,
	formatRows,
} from "@/lib/usage";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
	type KeysCell,
	type RowsCell,
	type StackCell,
	cellInsights,
	keysCell,
	rowsCell,
	stackCell,
} from "./overview-view";

/** "1h" reads "1h ago" in a cell header; a read that just landed stays "just now". */
const agoLabel = (age: string) =>
	age === "–" ? "" : age === "just now" ? age : `${age} ago`;

/** The label link and the age beside it. The link is the label only: the
 *  insight flag below is a button, and a button can't sit inside a link. */
function CellHead({
	href,
	label,
	aside,
}: { href: string; label: string; aside?: ReactNode }) {
	return (
		<div className="ov-cell-head">
			<Link href={href} className="ov-cell-link dash-label">
				{label}
			</Link>
			{aside ? <span className="ov-cell-aside">{aside}</span> : null}
		</div>
	);
}

/** One line under a cell about the thing it holds: a dot, what is wrong, and an optional Why. */
function Flag({
	dot,
	bad = false,
	children,
	action,
}: {
	dot: ReturnType<typeof severityDot>;
	bad?: boolean;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="ov-flag">
			<span className={`ins-dot ${dot}`} />
			<span className={`ov-flag-line${bad ? " bad" : ""}`}>{children}</span>
			{action}
		</div>
	);
}

function RowsCellView({
	cell,
	insights,
	open,
	onToggle,
}: {
	cell: RowsCell | null;
	insights: readonly Insight[];
	open: boolean;
	onToggle: () => void;
}) {
	const top = insights[0];
	const extra = insights.length - 1;
	return (
		<div className="ov-cell">
			<CellHead
				href="/account/rows"
				label={cell ? `Rows · ${cell.monthLabel}` : "Rows"}
				aside={cell ? agoLabel(cell.age) : null}
			/>
			{cell ? (
				<>
					<div className="ov-cell-big">
						{formatRows(cell.used)} <small>delivered</small>
					</div>
					<Meter
						used={cell.free}
						total={ROWS_ALLOWANCE}
						over={cell.paid}
						label="Rows this month"
					/>
					<p className="ov-cell-s">{cell.caption}</p>
				</>
			) : (
				<CellSkeleton />
			)}
			{top ? (
				<Flag
					dot={severityDot(top.severity)}
					bad={top.severity === "losing"}
					action={
						<button
							type="button"
							className="ov-flag-why"
							aria-expanded={open}
							aria-controls={`ins-panel-${top.id}`}
							onClick={onToggle}
						>
							{`${open ? "Hide" : "Why"} ›`}
						</button>
					}
				>
					<b>{top.line}</b>
					{top.meta ? ` · ${top.meta}` : ""}
					{extra > 0 ? (
						<span
							className="ov-more"
							title={`${extra} more ${extra === 1 ? "insight" : "insights"} on rows`}
						>
							{" "}
							+{extra}
						</span>
					) : null}
				</Flag>
			) : null}
		</div>
	);
}

function KeysCellView({ cell }: { cell: KeysCell | null }) {
	if (!cell) {
		return (
			<div className="ov-cell ov-cell-empty">
				<CellHead href="/account/keys" label="Keys" />
				<div className="ov-cell-big">None</div>
				<p className="ov-cell-s">
					Make one for each place that reads: <code>sl keys create</code>
				</p>
			</div>
		);
	}
	return (
		<div className="ov-cell">
			<CellHead href="/account/keys" label="Keys" aside={agoLabel(cell.age)} />
			<div className="ov-cell-keys">
				{cell.names.map((name) =>
					name.startsWith("+") ? (
						<span key={name} className="ov-more">
							{name}
						</span>
					) : (
						<code key={name}>{name}</code>
					),
				)}
			</div>
			<DayStrip days={cell.days} title="Days any key read, last 24 days" />
			<p className="ov-cell-s">{cell.caption}</p>
			{cell.stale ? (
				<Flag dot="hi">
					<Link href="/account/keys">
						{`${cell.stale.name} unused ${cell.stale.days} days`}
					</Link>
				</Flag>
			) : null}
		</div>
	);
}

function StackCellView({ cell }: { cell: StackCell | null }) {
	return (
		<div className="ov-cell">
			<CellHead
				href="/account/credits"
				label="Hosted stack"
				aside={
					cell ? (
						<span className="ov-cell-state">
							{cell.tone === "ok" ? null : (
								<span className={dotClass(cell.tone)} />
							)}
							{cell.word}
						</span>
					) : null
				}
			/>
			{cell ? (
				<>
					<div className={`ov-cell-big${cell.tone === "alarm" ? " bad" : ""}`}>
						{cell.perDay ?? "–"}
						<small>/day</small>
					</div>
					{cell.points.length > 1 ? (
						<MemoryBand
							points={cell.points}
							capacity={0}
							stopped={cell.tone === "alarm"}
							title="Hosted stack memory, last 24 hours"
						/>
					) : null}
					<p className="ov-cell-s">{cell.caption}</p>
				</>
			) : (
				<CellSkeleton />
			)}
		</div>
	);
}

/** Two shimmer lines for a cell whose data has not arrived. */
function CellSkeleton() {
	return (
		<>
			<Skel width="45%" height={20} />
			<Skel width="70%" />
		</>
	);
}

/** The strip's shape while the Overview's first data is in flight, so the swap doesn't move anything below it. */
export function PlumbingStripSkeleton() {
	return (
		<div className="ov-strip" aria-hidden="true">
			{["rows", "keys", "stack"].map((cell) => (
				<div key={cell} className="ov-cell">
					<div className="ov-cell-head">
						<Skel width={90} height={10} />
					</div>
					<Skel width="45%" height={20} />
					<Skel width="100%" height={30} style={{ display: "block" }} />
					<Skel width="70%" />
				</div>
			))}
		</div>
	);
}

/**
 * What powers the webhooks and subgraphs above: Rows (this month's meter),
 * Keys (24 days) and the hosted stack (cost per day and memory). Each cell
 * draws its own shape. A cell carries the insight about it as a one-line
 * flag; the card opens under the strip with a notch at the cell.
 */
export function PlumbingStrip({
	rows,
	keys,
	stack,
	burn,
	now,
	insights,
}: {
	rows: RowsResponse | null;
	keys: ApiKey[] | null;
	stack: HostedStack | null;
	burn: Burn | null;
	now: Date;
	insights: readonly Insight[];
}) {
	const forRows = cellInsights(insights).rows;
	const top = forRows[0];
	// What the reader chose, by insight id. Until they choose, a losing or
	// about-to-fail insight is open and a recovered one is a collapsed line.
	const [chosen, setChosen] = useState<Record<string, boolean>>({});
	const open = top ? (chosen[top.id] ?? autoOpenId([top]) !== null) : false;
	return (
		<>
			<section className="ov-strip" aria-label="Rows, keys and hosted stack">
				<RowsCellView
					cell={rows ? rowsCell(rows, now) : null}
					insights={forRows}
					open={open}
					onToggle={() =>
						top && setChosen((prev) => ({ ...prev, [top.id]: !open }))
					}
				/>
				<KeysCellView cell={keysCell(keys, now)} />
				<StackCellView cell={stackCell(stack, burn)} />
			</section>
			{top && open ? (
				<div className="ov-strip-card" id={`ins-panel-${top.id}`}>
					<InsightCard
						insight={top}
						footer={<InsightActions insight={top} />}
					/>
				</div>
			) : null}
		</>
	);
}
