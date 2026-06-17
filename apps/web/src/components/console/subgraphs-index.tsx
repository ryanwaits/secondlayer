"use client";

import {
	type DisplayStatus,
	badgeClass,
	getDisplayStatus,
	statusLabel,
} from "@/lib/intelligence/subgraphs";
import { usePreferences } from "@/lib/preferences";
import type { SubgraphSummary } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Filter = "all" | "live" | "syncing" | "error";

const FILTERS: { key: Filter; label: string }[] = [
	{ key: "all", label: "All" },
	{ key: "live", label: "Live" },
	{ key: "syncing", label: "Syncing" },
	{ key: "error", label: "Error" },
];

// Reindexing folds into the Syncing bucket for filtering (matches the mock's
// three working states beyond "All").
function bucketOf(ds: DisplayStatus): Exclude<Filter, "all"> {
	if (ds === "active") return "live";
	if (ds === "error" || ds === "stalled") return "error";
	return "syncing";
}

function rowCount(sg: SubgraphSummary): number {
	return sg.totalRows ?? sg.totalProcessed;
}

function timeAgo(iso?: string | null): string | null {
	if (!iso) return null;
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return null;
	const s = Math.max(0, Math.round((Date.now() - then) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}

function GlobeIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="6" />
			<path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" />
		</svg>
	);
}

function LockIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			aria-hidden="true"
		>
			<rect x="3" y="7" width="10" height="7" rx="1.5" />
			<path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
		</svg>
	);
}

function Visibility({ value }: { value?: "public" | "private" }) {
	const isPublic = value === "public";
	return (
		<span className={`sg-vis${isPublic ? " public" : ""}`}>
			{isPublic ? <GlobeIcon /> : <LockIcon />}
			{isPublic ? "Public" : "Private"}
		</span>
	);
}

export function SubgraphsIndex({
	subgraphs,
	chainTip,
}: {
	subgraphs: SubgraphSummary[];
	chainTip: number | null;
}) {
	const router = useRouter();
	const { subgraphsView, setSubgraphsView } = usePreferences();
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");

	const withStatus = useMemo(
		() =>
			subgraphs.map((sg) => {
				const ds = getDisplayStatus(sg, chainTip);
				return { sg, ds, bucket: bucketOf(ds) };
			}),
		[subgraphs, chainTip],
	);

	const counts = useMemo(() => {
		const c = { all: withStatus.length, live: 0, syncing: 0, error: 0 };
		for (const w of withStatus) c[w.bucket]++;
		return c;
	}, [withStatus]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return withStatus.filter(
			(w) =>
				(filter === "all" || w.bucket === filter) &&
				(q === "" || w.sg.name.toLowerCase().includes(q)),
		);
	}, [withStatus, filter, query]);

	return (
		<div className="sg-index">
			<div className="sg-index-head">
				<div className="sg-index-title-wrap">
					<h1 className="index-title">Subgraphs</h1>
					<span className="sg-index-count">{subgraphs.length} total</span>
				</div>
				<Link className="sg-btn sg-btn-primary" href="/docs/subgraphs">
					Deploy subgraph
				</Link>
			</div>

			<div className="sg-toolbar">
				<div className="sg-seg" role="toolbar" aria-label="Filter by status">
					{FILTERS.map((f) => (
						<button
							type="button"
							key={f.key}
							className={filter === f.key ? "on" : ""}
							aria-pressed={filter === f.key}
							onClick={() => setFilter(f.key)}
						>
							{f.label} <span className="n">{counts[f.key]}</span>
						</button>
					))}
				</div>
				<div className="sg-search">
					<svg
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						aria-hidden="true"
					>
						<circle cx="7" cy="7" r="4.5" />
						<path d="M10.5 10.5L14 14" />
					</svg>
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Filter by name…"
						aria-label="Filter subgraphs by name"
					/>
				</div>
				<div className="sg-viewsw" role="toolbar" aria-label="View mode">
					<button
						type="button"
						className={subgraphsView === "list" ? "on" : ""}
						aria-pressed={subgraphsView === "list"}
						aria-label="List view"
						title="List view"
						onClick={() => setSubgraphsView("list")}
					>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
						>
							<path d="M2 4h12M2 8h12M2 12h12" />
						</svg>
					</button>
					<button
						type="button"
						className={subgraphsView === "cards" ? "on" : ""}
						aria-pressed={subgraphsView === "cards"}
						aria-label="Card view"
						title="Card view"
						onClick={() => setSubgraphsView("cards")}
					>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.4"
							aria-hidden="true"
						>
							<rect x="2" y="2" width="5" height="5" rx="1" />
							<rect x="9" y="2" width="5" height="5" rx="1" />
							<rect x="2" y="9" width="5" height="5" rx="1" />
							<rect x="9" y="9" width="5" height="5" rx="1" />
						</svg>
					</button>
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="sg-empty-filtered">
					<span>
						No subgraphs match
						{query ? ` “${query}”` : ""}
						{filter !== "all" ? ` in ${filter}` : ""}.
					</span>
					<button
						type="button"
						className="sg-clear"
						onClick={() => {
							setFilter("all");
							setQuery("");
						}}
					>
						Clear filters
					</button>
				</div>
			) : subgraphsView === "cards" ? (
				<div className="sg-cards">
					{filtered.map(({ sg, ds }) => (
						<SubgraphCard key={sg.name} sg={sg} ds={ds} chainTip={chainTip} />
					))}
				</div>
			) : (
				<table className="sg-ledger">
					<thead>
						<tr>
							<th>Name</th>
							<th>Status</th>
							<th className="num">Tables</th>
							<th className="num">Rows indexed</th>
							<th className="num">Last block</th>
							<th>Visibility</th>
							<th aria-hidden="true" />
						</tr>
					</thead>
					<tbody>
						{filtered.map(({ sg }) => (
							// biome-ignore lint/a11y/useKeyWithClickEvents: the name link provides keyboard navigation; the row click is a mouse-only convenience
							<tr
								key={sg.name}
								onClick={() => router.push(`/subgraphs/${sg.name}`)}
							>
								<td>
									<span className="sg-name-cell">
										<Link
											href={`/subgraphs/${sg.name}`}
											className="sg-name"
											onClick={(e) => e.stopPropagation()}
										>
											{sg.name}
										</Link>
										<span className="sg-ver">v{sg.version}</span>
									</span>
								</td>
								<td>
									<span className={`badge ${badgeClass(sg, chainTip)}`}>
										{statusLabel(sg, chainTip)}
									</span>
								</td>
								<td className="num">{sg.tables.length}</td>
								<td className="num">{rowCount(sg).toLocaleString()}</td>
								<td className="num">
									{sg.lastProcessedBlock != null
										? sg.lastProcessedBlock.toLocaleString()
										: "—"}
								</td>
								<td>
									<Visibility value={sg.visibility} />
								</td>
								<td className="sg-chev-cell">
									<svg
										className="sg-chev"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										aria-hidden="true"
									>
										<path d="M6 3l5 5-5 5" />
									</svg>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

function SubgraphCard({
	sg,
	ds,
	chainTip,
}: {
	sg: SubgraphSummary;
	ds: DisplayStatus;
	chainTip: number | null;
}) {
	const inflight = ds === "syncing" || ds === "reindexing";
	const isError = ds === "error" || ds === "stalled";
	const progress = Math.max(0, Math.min(100, Math.round(sg.progress ?? 0)));
	const subs = sg.subscriptionCount ?? 0;

	return (
		<Link
			href={`/subgraphs/${sg.name}`}
			className={`sg-card${isError ? " is-error" : ""}`}
		>
			{inflight && (
				<div className="sg-card-bar">
					<i style={{ width: `${progress}%` }} />
				</div>
			)}
			<div className="sg-card-body">
				<div className="sg-card-hd">
					<span className="sg-card-name">{sg.name}</span>
					<span className="sg-ver">v{sg.version}</span>
					<span className={`badge ${badgeClass(sg, chainTip)}`}>
						{statusLabel(sg, chainTip)}
					</span>
					<span className="sg-card-meta">
						<b>{rowCount(sg).toLocaleString()}</b> rows ·{" "}
						<b>{sg.tables.length}</b> table{sg.tables.length !== 1 ? "s" : ""}
					</span>
				</div>
				<div className="sg-card-chips">
					{sg.tables.map((t) => (
						<span key={t} className="sg-tchip">
							{t}
						</span>
					))}
				</div>
			</div>
			<div className="sg-card-ft">
				<CardStatusLine sg={sg} ds={ds} progress={progress} />
				{subs > 0 && (
					<span className="sg-card-subs">
						{subs} sub{subs !== 1 ? "s" : ""}
					</span>
				)}
				<span
					className={`sg-card-vis${sg.visibility === "public" ? " public" : ""}`}
				>
					{sg.visibility === "public" ? <GlobeIcon /> : <LockIcon />}
					{sg.visibility === "public" ? "Public" : "Private"}
				</span>
			</div>
		</Link>
	);
}

function CardStatusLine({
	sg,
	ds,
	progress,
}: {
	sg: SubgraphSummary;
	ds: DisplayStatus;
	progress: number;
}) {
	if (ds === "error" || ds === "stalled") {
		return (
			<span className="sg-card-state">
				<svg
					className="ic"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
				>
					<circle cx="8" cy="8" r="6.5" />
					<path d="M8 5v3.5M8 11h.01" />
				</svg>
				<span className="c-red">{sg.lastError || "Indexing error"}</span>
			</span>
		);
	}
	if (ds === "reindexing") {
		return (
			<span className="sg-card-state">
				<span className="c-blue">{progress}%</span>
				<span className="sep">·</span>
				<span>reindexing</span>
			</span>
		);
	}
	if (ds === "syncing") {
		const behind = sg.blocksRemaining;
		return (
			<span className="sg-card-state">
				<span className="c-blue">{progress}%</span>
				<span className="sep">·</span>
				<span>
					{behind != null
						? `${behind.toLocaleString()} block${behind !== 1 ? "s" : ""} behind`
						: "catching up"}
				</span>
			</span>
		);
	}
	const fresh = timeAgo(sg.updatedAt);
	return (
		<span className="sg-card-state">
			<span className="c-green">synced</span>
			<span className="sep">·</span>
			<span>{fresh ? `updated ${fresh}` : "at tip"}</span>
		</span>
	);
}
