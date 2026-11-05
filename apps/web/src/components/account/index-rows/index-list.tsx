"use client";

import { RibbonDays } from "@/components/dashboard/charts/hour-ribbon";
import {
	type IndexPage,
	type IndexView,
	readIndexViews,
	writeIndexViews,
} from "@/lib/index-view";
import { useRowLink } from "@/lib/intent-prefetch";
import { hostOf } from "@/lib/webhooks-data";
import type { WebhookSummary } from "@secondlayer/sdk";
import Link from "next/link";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { FINDABLE_MIN, filterRows } from "./filter";
import type { RowStatus, StatusGroup } from "./status";

const GROUP_ORDER: readonly StatusGroup[] = ["ok", "hi", "alarm", "idle"];

const ICON_PROPS = {
	viewBox: "0 0 16 16",
	fill: "none",
	stroke: "currentColor",
} as const;

function SearchIcon() {
	return (
		<svg {...ICON_PROPS} aria-hidden="true" strokeWidth="1.6">
			<circle cx="7" cy="7" r="4.5" />
			<path d="m10.5 10.5 3 3" />
		</svg>
	);
}

function FilterIcon() {
	return (
		<svg {...ICON_PROPS} aria-hidden="true" strokeWidth="1.6">
			<path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
		</svg>
	);
}

function RowsIcon() {
	return (
		<svg {...ICON_PROPS} aria-hidden="true" strokeWidth="1.5">
			<rect x="2" y="2.5" width="12" height="4.5" rx="1" />
			<rect x="2" y="9" width="12" height="4.5" rx="1" />
		</svg>
	);
}

function RibbonIcon() {
	return (
		<svg {...ICON_PROPS} aria-hidden="true" strokeWidth="1.5">
			<path d="M2 4h12M2 8h12M2 12h12" />
		</svg>
	);
}

/** A row's name, with its status next to it when something needs the reader.
 *  A failing name gets the red box; a healthy row shows no status at all. */
export function RowName({
	name,
	display = name,
	status,
	children,
}: {
	name: string;
	/** The name as shown, when it differs (long addresses shortened). */
	display?: string;
	status: RowStatus;
	/** Anything that belongs right after the name, like the managed-by chip. */
	children?: ReactNode;
}) {
	return (
		<span className={`ix-name${status.group === "alarm" ? " bad" : ""}`}>
			<b title={name}>{display}</b>
			{children}
			{status.label ? (
				<span className={`ix-chip ${status.group}`}>
					<span className={`ix-dot ${status.group}`} />
					{status.label}
				</span>
			) : null}
		</span>
	);
}

/** One index row: the whole box opens the resource (the link inside is the
 *  keyboard and screen-reader way in), and its hover fill is the box itself. */
export function RowShell({
	href,
	children,
	main,
}: {
	href: string;
	/** What sits beside the text: the strip, the numbers. */
	children: ReactNode;
	/** The text column, inside the link. */
	main: ReactNode;
}) {
	const row = useRowLink(href);
	return (
		<div className="ix-row" {...row}>
			<Link href={href} prefetch={false} className="ix-main">
				{main}
			</Link>
			{children}
		</div>
	);
}

/** The one-line why under a name, red for a failing row. */
export function RowWhy({
	text,
	group,
}: {
	text: string;
	group: StatusGroup;
}) {
	return (
		<span className={`ix-why${group === "alarm" ? " alarm" : ""}`}>{text}</span>
	);
}

/** Where a healthy webhook sends: its kind and the host it posts to. */
export function WebhookRoute({
	webhook,
}: {
	webhook: Pick<WebhookSummary, "kind" | "url">;
}) {
	return (
		<span className="ix-route">
			{webhook.kind} events → <b>{hostOf(webhook.url)}</b>
		</span>
	);
}

/** Where a healthy subgraph's rows go: its tables. */
export function SubgraphRoute({ tables }: { tables: number }) {
	return (
		<span className="ix-route">
			chain events →{" "}
			<b>
				{tables} {tables === 1 ? "table" : "tables"}
			</b>
		</span>
	);
}

/** Three numbers at the bottom of a Rows-view row. */
export function RowStats({
	stats,
}: {
	stats: readonly { value: string; label: string; alarm?: boolean }[];
}) {
	return (
		<span className="ix-stats">
			{stats.map((stat) => (
				<span className="ix-stat" key={stat.label}>
					<strong className={stat.alarm ? "alarm" : undefined}>
						{stat.value}
					</strong>
					<small>{stat.label}</small>
				</span>
			))}
		</span>
	);
}

function IndexKey({
	flagged,
	failedLabel,
}: {
	flagged: boolean;
	failedLabel: string;
}) {
	return (
		<span className="ix-key">
			<span className="ix-key-group">
				Less
				<span className="ix-ramp">
					{[0.25, 0.45, 0.7, 1].map((opacity) => (
						<i key={opacity} style={{ opacity }} />
					))}
				</span>
				More
			</span>
			{flagged ? (
				<span className="ix-key-group">
					<i className="h" />
					Needs a look
				</span>
			) : null}
			<span className="ix-key-group">
				<i className="f" />
				{failedLabel}
			</span>
			<span className="ix-key-group">
				<i className="z" />
				None
			</span>
		</span>
	);
}

export interface IndexListProps<T> {
	page: IndexPage;
	/** Plural, lowercase: "webhooks". */
	noun: string;
	/** Singular, lowercase: "webhook". */
	singular: string;
	rows: readonly T[];
	rowKey: (row: T) => string;
	/** What search matches: the name and the route text. */
	textOf: (row: T) => string;
	groupOf: (row: T) => StatusGroup;
	groupLabels: Record<StatusGroup, string>;
	/** The key's red square: "Failed" or "Handler failed". */
	failedLabel: string;
	/** The Ribbon header's number column: "7 days" or "Rows". */
	numberLabel: string;
	/** Midpoint of the newest hour of the one shared timeline; null while it is unknown. */
	now: number | null;
	initialView?: IndexView;
	renderRow: (
		row: T,
		context: { view: IndexView; isLast: boolean },
	) => ReactNode;
}

/** The index page's list: toolbar (search and status once there are enough
 *  rows, the view switch always), a count with the colour key, and the rows. */
export function IndexList<T>({
	page,
	noun,
	singular,
	rows,
	rowKey,
	textOf,
	groupOf,
	groupLabels,
	failedLabel,
	numberLabel,
	now,
	initialView = "rows",
	renderRow,
}: IndexListProps<T>) {
	const [view, setView] = useState<IndexView>(initialView);
	const [q, setQ] = useState("");
	const [group, setGroup] = useState<StatusGroup | "all">("all");
	const [menuOpen, setMenuOpen] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const filterRef = useRef<HTMLDivElement>(null);
	const menuId = useId();

	const findable = rows.length >= FINDABLE_MIN;
	const filter = findable ? { q, group } : { q: "", group: "all" as const };
	const shown = filterRows(rows, filter, textOf, groupOf);
	const counts = new Map<StatusGroup, number>();
	for (const row of rows) {
		counts.set(groupOf(row), (counts.get(groupOf(row)) ?? 0) + 1);
	}
	const flagged = (counts.get("hi") ?? 0) > 0;

	// "/" focuses search from anywhere that isn't a field.
	useEffect(() => {
		if (!findable) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
			const target = e.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable]")) return;
			e.preventDefault();
			searchRef.current?.focus();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [findable]);

	useEffect(() => {
		if (!menuOpen) return;
		const onPointer = (e: PointerEvent) => {
			if (!filterRef.current?.contains(e.target as Node)) setMenuOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setMenuOpen(false);
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuOpen]);

	function pickView(next: IndexView) {
		setView(next);
		writeIndexViews({ ...readIndexViews(), [page]: next });
	}

	function reset() {
		setQ("");
		setGroup("all");
	}

	const count =
		shown.length === rows.length
			? `${rows.length} ${rows.length === 1 ? singular : noun}`
			: `${shown.length} of ${rows.length} ${noun}`;
	const trimmedQ = q.trim();

	return (
		<>
			<div className="ix-tools">
				{findable ? (
					<>
						<label className="ix-search">
							<SearchIcon />
							<input
								ref={searchRef}
								id="index-q"
								type="search"
								value={q}
								placeholder={`Search ${noun}`}
								aria-label={`Search ${noun}`}
								autoComplete="off"
								onChange={(e) => setQ(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Escape") setQ("");
								}}
							/>
							<kbd>/</kbd>
						</label>
						<div className="ix-status" ref={filterRef}>
							<div className="ix-ctl">
								<button
									type="button"
									className="ix-ctl-main"
									aria-haspopup="menu"
									aria-expanded={menuOpen}
									aria-controls={menuOpen ? menuId : undefined}
									onClick={() => setMenuOpen((open) => !open)}
								>
									<FilterIcon />
									{group === "all" ? (
										"Status"
									) : (
										<span className="ix-on">
											<span className={`ix-dot ${group}`} />
											{groupLabels[group]}
										</span>
									)}
								</button>
								{group === "all" ? null : (
									<button
										type="button"
										className="ix-ctl-x"
										aria-label="Clear status"
										onClick={() => {
											setGroup("all");
											setMenuOpen(false);
										}}
									>
										×
									</button>
								)}
							</div>
							{menuOpen ? (
								<div className="ix-menu" role="menu" id={menuId}>
									<button
										type="button"
										role="menuitemradio"
										aria-checked={group === "all"}
										onClick={() => {
											setGroup("all");
											setMenuOpen(false);
										}}
									>
										<span className="ix-dot all" />
										All
										<span className="ix-n">{rows.length}</span>
									</button>
									{GROUP_ORDER.filter((g) => (counts.get(g) ?? 0) > 0).map(
										(g) => (
											<button
												type="button"
												role="menuitemradio"
												aria-checked={group === g}
												key={g}
												onClick={() => {
													setGroup(g);
													setMenuOpen(false);
												}}
											>
												<span className={`ix-dot ${g}`} />
												{groupLabels[g]}
												<span className="ix-n">{counts.get(g)}</span>
											</button>
										),
									)}
								</div>
							) : null}
						</div>
					</>
				) : null}
				<span className="ix-view" role="toolbar" aria-label="View">
					<button
						type="button"
						aria-label="Rows"
						aria-pressed={view === "rows"}
						onClick={() => pickView("rows")}
					>
						<RowsIcon />
					</button>
					<button
						type="button"
						aria-label="Ribbon"
						aria-pressed={view === "ribbon"}
						onClick={() => pickView("ribbon")}
					>
						<RibbonIcon />
					</button>
				</span>
			</div>

			<div className="ix-meta">
				<span className="ix-count">{count}</span>
				<IndexKey flagged={flagged} failedLabel={failedLabel} />
			</div>

			<div className={`ix-list ${view === "ribbon" ? "ix-ribbon" : "ix-rows"}`}>
				{shown.length === 0 ? (
					<div className="ix-empty">
						No {noun} match{trimmedQ ? ` “${trimmedQ}”` : " this status"}.
						<button type="button" onClick={reset}>
							Clear
						</button>
					</div>
				) : (
					<>
						{view === "ribbon" ? (
							<div className="ix-cols">
								<span>Name</span>
								{now === null ? <span /> : <RibbonDays now={now} />}
								<span className="r">{numberLabel}</span>
								<span className="r">Last</span>
							</div>
						) : null}
						{shown.map((row, i) => (
							<Fragment key={rowKey(row)}>
								{renderRow(row, {
									view,
									isLast: i === shown.length - 1,
								})}
							</Fragment>
						))}
					</>
				)}
			</div>
		</>
	);
}
