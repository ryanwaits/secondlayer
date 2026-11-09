"use client";

import { DayStrip } from "@/components/dashboard/charts/day-strip";
import { MemoryBand } from "@/components/dashboard/charts/memory-band";
import { Meter } from "@/components/dashboard/charts/meter";
import { Skel } from "@/components/dashboard/shell/skel";
import { IntentLink } from "@/components/intent-link";
import type { severityDot } from "@/lib/insights";
import type { RowsResponse } from "@/lib/rows";
import type { ApiKey } from "@/lib/types";
import {
	type Burn,
	type HostedStack,
	ROWS_ALLOWANCE,
	formatRows,
} from "@/lib/usage";
import type { ReactNode } from "react";
import {
	type KeysCell,
	type RowsCell,
	type StackCell,
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
			<IntentLink href={href} className="ov-cell-link dash-label">
				{label}
			</IntentLink>
			{aside ? <span className="ov-cell-aside">{aside}</span> : null}
		</div>
	);
}

/** One line under a cell about the thing it holds: a dot and what is wrong. */
function Flag({
	dot,
	children,
}: {
	dot: ReturnType<typeof severityDot>;
	children: ReactNode;
}) {
	return (
		<div className="ov-flag">
			<span className={`ins-dot ${dot}`} />
			<span className="ov-flag-line">{children}</span>
		</div>
	);
}

function RowsCellView({ cell }: { cell: RowsCell | null }) {
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
		</div>
	);
}

function KeysCellView({
	cell,
	loaded,
}: { cell: KeysCell | null; loaded: boolean }) {
	if (!loaded) {
		return (
			<div className="ov-cell">
				<CellHead href="/account/keys" label="Keys" />
				<CellSkeleton />
			</div>
		);
	}
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
			<div className="ov-cell-chart ov-days">
				<DayStrip days={cell.days} title="Days any key read, last 24 days" />
			</div>
			<p className="ov-cell-s">{cell.caption}</p>
			{cell.stale ? (
				<Flag dot="hi">
					<IntentLink href="/account/keys">
						{`${cell.stale.name} unused ${cell.stale.days} days`}
					</IntentLink>
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
				aside={cell ? <span className="ov-cell-state">{cell.word}</span> : null}
			/>
			{cell ? (
				<>
					<div className={`ov-cell-big${cell.tone === "alarm" ? " bad" : ""}`}>
						{cell.perDay ?? "–"}
						<small>/day</small>
					</div>
					{cell.points.length > 1 ? (
						<div className="ov-cell-chart ov-band">
							<MemoryBand
								points={cell.points}
								capacity={0}
								stopped={cell.tone === "alarm"}
								title="Hosted stack memory, last 24 hours"
							/>
						</div>
					) : null}
					<p className="ov-cell-s">{cell.caption}</p>
				</>
			) : (
				<CellSkeleton />
			)}
		</div>
	);
}

/** A cell whose data has not arrived, as tall as the one that replaces it
 *  (the hosted stack cell, the tallest): a big figure, a chart, a caption. */
function CellSkeleton() {
	return (
		<>
			<Skel width="45%" height={20} />
			<Skel width="100%" height={30} />
			<Skel width="70%" height={18} />
		</>
	);
}

/** The strip's shape while the Overview's first data is in flight. Each line
 *  is as tall as what replaces it, so the swap doesn't move anything. */
export function PlumbingStripSkeleton() {
	return (
		<div className="ov-strip" aria-hidden="true">
			{["rows", "keys", "stack"].map((cell) => (
				<div key={cell} className="ov-cell">
					<div className="ov-cell-head">
						<Skel width={90} height={12} />
					</div>
					<CellSkeleton />
				</div>
			))}
		</div>
	);
}

/**
 * What powers the webhooks and subgraphs above: Rows (this month's meter),
 * Keys (24 days) and the hosted stack (cost per day and memory). Each cell
 * draws its own shape. Their insights sit in the Overview's one line.
 */
export function PlumbingStrip({
	rows,
	keys,
	stack,
	burn,
	now,
	asleep,
	creditsUsdMicros,
}: {
	rows: RowsResponse | null;
	keys: ApiKey[] | null;
	stack: HostedStack | null;
	burn: Burn | null;
	now: Date;
	/** Every webhook is paused. */
	asleep: boolean;
	/** Credits left in USD micros; null until billing has loaded. */
	creditsUsdMicros: string | null;
}) {
	return (
		<section className="ov-strip" aria-label="Rows, keys and hosted stack">
			<RowsCellView cell={rows ? rowsCell(rows, now) : null} />
			<KeysCellView cell={keysCell(keys, now)} loaded={keys !== null} />
			<StackCellView
				cell={stackCell(stack, burn, { asleep, creditsUsdMicros })}
			/>
		</section>
	);
}
