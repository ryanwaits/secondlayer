"use client";

import { useAuth } from "@/lib/auth";
import {
	type CommandItem,
	DOCS_ITEMS,
	NAV_ITEMS,
} from "@/lib/command-center/items";
import {
	frecencyBoosts,
	recentIds,
	recordSelection,
} from "@/lib/command-center/recents";
import {
	type ResultGroup,
	type ScoredItem,
	rankCommandItems,
} from "@/lib/command-center/search";
import { useCommandSources } from "@/lib/command-center/sources";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Command center v1: navigation + discovery only. Fuzzy search over nav
 * routes, your subgraphs/subscriptions, public subgraphs, and docs pages.
 * Selecting a result opens its page — no verbs, no writes, no remote
 * search, no loading states (docs/specs/command-center.spec.md).
 */
export function CommandPalette() {
	const router = useRouter();
	const { logout } = useAuth();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const resources = useCommandSources(open);
	// Frecency reads localStorage — refresh once per palette open, not per key.
	// biome-ignore lint/correctness/useExhaustiveDependencies: boosts refresh on open
	const boosts = useMemo(() => frecencyBoosts(), [open]);

	const t0 = performance.now();
	const { groups, flat } = useMemo(() => {
		const all = [...NAV_ITEMS, ...resources, ...DOCS_ITEMS];
		if (query.trim()) return rankCommandItems(query, all, boosts);
		// Empty state: nav shortcuts (recents-boosted) + last-used resources.
		const ranked = rankCommandItems("", NAV_ITEMS, boosts);
		const byId = new Map(resources.map((i) => [i.id, i]));
		const recents: ScoredItem[] = recentIds(20)
			.map((id) => byId.get(id))
			.filter((i): i is CommandItem => !!i)
			.slice(0, 3)
			.map((item) => ({ item, score: 0, range: null }));
		if (recents.length > 0) {
			const groups: ResultGroup[] = [
				...ranked.groups,
				{ group: "your subgraphs", items: recents },
			];
			return { groups, flat: [...ranked.flat, ...recents] };
		}
		return ranked;
	}, [query, resources, boosts]);
	const ms = performance.now() - t0;

	const openPalette = useCallback(() => {
		setQuery("");
		setSelectedIdx(0);
		setOpen(true);
	}, []);

	const closePalette = useCallback(() => {
		setOpen(false);
		setQuery("");
		setSelectedIdx(0);
	}, []);

	const execute = useCallback(
		(scored: ScoredItem, newTab: boolean) => {
			const { item } = scored;
			recordSelection(item.id);
			closePalette();
			if (item.actionId === "logout") {
				logout();
				router.push("/");
				return;
			}
			if (!item.href) return;
			if (newTab || item.newTab) {
				window.open(item.href, "_blank", "noopener");
			} else {
				router.push(item.href);
			}
		},
		[closePalette, router, logout],
	);

	// Global ⌘K shortcut
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				if (open) closePalette();
				else openPalette();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, openPalette, closePalette]);

	// Focus input when palette opens
	useEffect(() => {
		if (open) setTimeout(() => inputRef.current?.focus(), 0);
	}, [open]);

	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				if (query) {
					setQuery("");
					setSelectedIdx(0);
				} else {
					closePalette();
				}
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIdx((i) => Math.min(i + 1, flat.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIdx((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (flat[selectedIdx]) execute(flat[selectedIdx], e.metaKey);
			}
		},
		[closePalette, flat, selectedIdx, execute, query],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection only when query string changes
	useEffect(() => {
		setSelectedIdx(0);
	}, [query]);

	// Wire the topbar/sidebar ⌘K affordances
	useEffect(() => {
		function onClick(e: Event) {
			if ((e.target as HTMLElement).closest(".dash-cmdk")) {
				openPalette();
			}
		}
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [openPalette]);

	if (!open) return null;

	let runningIdx = -1;

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: overlay backdrop is a visual affordance; Escape is handled at modal level
		<div className="palette-overlay" onClick={closePalette}>
			<div
				className="palette"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={onKeyDown}
			>
				<div className="palette-input-row">
					<SearchIcon />
					<input
						ref={inputRef}
						className="palette-input"
						type="text"
						placeholder="Search subgraphs, subscriptions, docs…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>

				<div className="palette-divider" />

				<div className="palette-body">
					{groups.map((g, gi) => (
						<div key={g.group}>
							<div className="palette-group-label">
								{!query && gi > 0 ? "recent" : g.group}
							</div>
							{g.items.map((scored) => {
								runningIdx += 1;
								const idx = runningIdx;
								return (
									<PaletteItem
										key={scored.item.id}
										scored={scored}
										selected={idx === selectedIdx}
										onClick={(e) => execute(scored, e.metaKey)}
										onMouseEnter={() => setSelectedIdx(idx)}
									/>
								);
							})}
						</div>
					))}
				</div>

				<div className="palette-footer">
					<div className="palette-footer-left">
						<span className="palette-footer-hint">
							Open <kbd>&#9166;</kbd>
						</span>
						<span className="palette-footer-hint">
							New tab <kbd>&#8984;&#9166;</kbd>
						</span>
						<span className="palette-footer-hint">
							<kbd>&uarr;</kbd>
							<kbd>&darr;</kbd>
						</span>
					</div>
					<div className="palette-footer-right">
						{flat.length} result{flat.length === 1 ? "" : "s"} ·{" "}
						{ms < 1 ? "<1" : Math.round(ms)}ms
					</div>
				</div>
			</div>
		</div>
	);
}

function PaletteItem({
	scored,
	selected,
	onClick,
	onMouseEnter,
}: {
	scored: ScoredItem;
	selected: boolean;
	onClick: (e: React.MouseEvent) => void;
	onMouseEnter: () => void;
}) {
	const { item, range } = scored;
	const itemRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (selected && itemRef.current) {
			itemRef.current.scrollIntoView({ block: "nearest" });
		}
	}, [selected]);

	const label = range ? (
		<>
			{item.label.slice(0, range[0])}
			<mark>{item.label.slice(range[0], range[1])}</mark>
			{item.label.slice(range[1])}
		</>
	) : (
		item.label
	);

	return (
		<div
			ref={itemRef}
			className={`palette-item ${selected ? "selected" : ""}`}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ")
					onClick(e as unknown as React.MouseEvent);
			}}
			onMouseEnter={onMouseEnter}
		>
			<span className="palette-item-label">{label}</span>
			{item.sub && <span className="palette-item-sub">{item.sub}</span>}
			<span className="palette-item-meta">
				{item.badge && (
					<span className={`palette-badge ${item.badge.tone}`}>
						{item.badge.text}
					</span>
				)}
				{item.newTab && <span className="palette-item-ext">&#8599;</span>}
			</span>
		</div>
	);
}

function SearchIcon() {
	return (
		<svg
			aria-hidden="true"
			className="palette-search-icon"
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
		>
			<circle cx="7" cy="7" r="4.5" />
			<path d="M10.5 10.5L14 14" />
		</svg>
	);
}
