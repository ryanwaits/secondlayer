"use client";

import {
	type MatchResult,
	fuzzyMatch,
	highlightLabel,
} from "@/lib/actions/fuzzy-match";
import { actions, getActionsByCategory } from "@/lib/actions/registry";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export function CommandPalette() {
	const router = useRouter();
	const { logout } = useAuth();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selectedIdx, setSelectedIdx] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const results = fuzzyMatch(query, actions);

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

	const executeAction = useCallback(
		(result: MatchResult) => {
			const { action } = result;
			closePalette();
			if (action.id === "logout") {
				logout();
				router.push("/");
				return;
			}
			if (action.href) {
				router.push(action.href);
			}
		},
		[closePalette, router, logout],
	);

	// Global ⌘K shortcut
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "k" && e.metaKey) {
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

	// Keyboard navigation
	const onKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				closePalette();
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIdx((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (results[selectedIdx]) {
					executeAction(results[selectedIdx]);
				}
			}
		},
		[closePalette, results, selectedIdx, executeAction],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection only when query string changes
	useEffect(() => {
		setSelectedIdx(0);
	}, [query]);

	// Wire ⌘K bar in topbar
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
						placeholder="Search or jump to..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>

				<div className="palette-divider" />

				<div className="palette-body">
					<PaletteResults
						query={query}
						results={results}
						selectedIdx={selectedIdx}
						onSelect={executeAction}
						onHover={setSelectedIdx}
					/>
				</div>

				<div className="palette-footer">
					<div className="palette-footer-left">
						<span className="palette-footer-hint">
							Open <kbd>&#9166;</kbd>
						</span>
						<span className="palette-footer-hint">
							<kbd>&uarr;</kbd>
							<kbd>&darr;</kbd>
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function PaletteResults({
	query,
	results,
	selectedIdx,
	onSelect,
	onHover,
}: {
	query: string;
	results: MatchResult[];
	selectedIdx: number;
	onSelect: (r: MatchResult) => void;
	onHover: (i: number) => void;
}) {
	if (query && results.length === 0) {
		return (
			<div className="palette-empty">No results for &ldquo;{query}&rdquo;</div>
		);
	}

	// Group by category
	const categories = getActionsByCategory(results.map((r) => r.action));

	let idx = 0;
	const elements: React.ReactNode[] = [];

	for (const [category, categoryActions] of categories) {
		elements.push(
			<div key={`cat-${category}`} className="palette-group-label">
				{category}
			</div>,
		);

		for (const action of categoryActions) {
			const result = results.find((r) => r.action.id === action.id);
			if (!result) continue;
			const currentIdx = idx++;
			elements.push(
				<PaletteItem
					key={action.id}
					result={result}
					selected={currentIdx === selectedIdx}
					onClick={() => onSelect(result)}
					onMouseEnter={() => onHover(currentIdx)}
				/>,
			);
		}
	}

	return <>{elements}</>;
}

function PaletteItem({
	result,
	selected,
	onClick,
	onMouseEnter,
}: {
	result: MatchResult;
	selected: boolean;
	onClick: () => void;
	onMouseEnter: () => void;
}) {
	const { action, ranges } = result;
	const parts = highlightLabel(action.label, ranges);
	const itemRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (selected && itemRef.current) {
			itemRef.current.scrollIntoView({ block: "nearest" });
		}
	}, [selected]);

	return (
		<div
			ref={itemRef}
			className={`palette-item ${selected ? "selected" : ""}`}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") onClick();
			}}
			onMouseEnter={onMouseEnter}
		>
			<span className="palette-item-label">
				{parts.map((p, i) =>
					typeof p === "string" ? (
						p
					) : (
						<mark key={`${p.text}-${i}`}>{p.text}</mark>
					),
				)}
			</span>
			<span className="palette-item-type">{action.category.toLowerCase()}</span>
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
