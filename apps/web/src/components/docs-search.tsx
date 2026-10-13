"use client";

import apiNav from "@/generated/openapi-nav.json";
import { refreshKeys, useAccountData } from "@/lib/account-data";
import { useAuth } from "@/lib/auth";
import {
	type CommandItem,
	DOCS_ITEMS,
	docsSearchPool,
} from "@/lib/command-center/items";
import { frecencyBoosts, recordSelection } from "@/lib/command-center/recents";
import { rankCommandItems } from "@/lib/command-center/search";
import { accountSummary, keyHint } from "@/lib/docs-account-summary";
import { SITE, markdownPath } from "@/lib/docs-agent";
import { copyText } from "@/lib/docs-clipboard";
import { buildPrompt, chipUrl } from "@/lib/docs-prompt";
import { refreshList, useWebhooksCache } from "@/lib/webhooks-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export type DocsHeadingEntry = {
	href: string;
	anchor: string;
	title: string;
};

type Row =
	| { kind: "command" }
	| { kind: "hit"; item: CommandItem }
	| { kind: "attach"; item: CommandItem }
	| { kind: "to-prompt" }
	| { kind: "copy" };

const MAX_HITS = 5;
const MAX_YOURS = 3;
const MAX_EMPTY_DOCS = 4;
/** `@` at the start or after a space, running to the end of the input. */
const ATTACH = /(^|\s)@(\S*)$/;
const WEBHOOK_PREFIX = "webhook:";
const PROMPT_VERB = /^\/prompt\s+/;

function wordCount(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** Same page: scroll there and let the docs view open a `<details>` target. */
function jumpOnPage(anchor: string | undefined) {
	if (!anchor) {
		window.scrollTo({ top: 0 });
		return;
	}
	const hash = `#${anchor}`;
	if (window.location.hash === hash) {
		window.dispatchEvent(new HashChangeEvent("hashchange"));
	} else {
		window.location.hash = hash;
	}
}

function SearchIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
			<circle
				cx="7"
				cy="7"
				r="5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			/>
			<path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.5" />
		</svg>
	);
}

/**
 * The docs top-nav search: type to search pages, sections and endpoints,
 * `/prompt` to copy a prompt for a coding agent. Runs entirely in the browser.
 */
export function DocsSearch({ headings }: { headings: DocsHeadingEntry[] }) {
	const router = useRouter();
	const pathname = usePathname();
	const listId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const [value, setValue] = useState("");
	const [verb, setVerb] = useState(false);
	const [focused, setFocused] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [selected, setSelected] = useState(0);
	const [busy, setBusy] = useState(false);
	/** Items attached with `@`; they feed the prompt and nothing else. */
	const [chips, setChips] = useState<CommandItem[]>([]);
	const { account } = useAuth();
	const { keys } = useAccountData();
	const { list } = useWebhooksCache();
	const fetchedAccount = useRef(false);
	/** The prompt, shown for hand-copying when the clipboard refuses. */
	const [manual, setManual] = useState<string | null>(null);

	const pool = useMemo(() => docsSearchPool(headings, apiNav), [headings]);

	const yours = useMemo<CommandItem[]>(
		() =>
			account
				? (list?.data ?? []).map((w) => ({
						id: `${WEBHOOK_PREFIX}${w.id}`,
						group: "webhooks" as const,
						label: w.name,
						sub:
							w.circuitFailures > 0
								? `${w.status} · ${w.circuitFailures} failing`
								: w.status,
						badge: { text: "live", tone: "live" as const },
					}))
				: [],
		[account, list],
	);

	const text = value.trim();
	const commandMode = !verb && /^\/[\w-]*$/.test(value);
	const attachFrag = ATTACH.exec(value)?.[2];
	const attachMode = attachFrag !== undefined;

	const attachItems = useMemo(() => {
		if (attachFrag === undefined) return [];
		const taken = new Set(chips.map((c) => c.id));
		const free = (i: CommandItem) => !taken.has(i.id);
		const mine = yours.filter(free);
		if (!attachFrag) {
			return [
				...mine.slice(0, MAX_YOURS),
				...DOCS_ITEMS.filter(free).slice(0, MAX_EMPTY_DOCS),
			];
		}
		const ranked = rankCommandItems(
			attachFrag,
			[...mine, ...pool.filter(free)],
			frecencyBoosts(),
		)
			.flat.map((s) => s.item)
			.filter((i) => i.id !== "docs:fallback");
		return [
			...ranked.filter((i) => i.group === "webhooks").slice(0, MAX_YOURS),
			...ranked.filter((i) => i.group !== "webhooks"),
		];
	}, [attachFrag, chips, yours, pool]);

	const hits = useMemo(() => {
		if (verb || commandMode || attachMode || !text) return [];
		return rankCommandItems(text, pool, frecencyBoosts())
			.flat.map((s) => s.item)
			.filter((i) => i.id !== "docs:fallback")
			.slice(0, MAX_HITS);
	}, [verb, commandMode, attachMode, text, pool]);

	const rows = useMemo<Row[]>(() => {
		if (attachMode) {
			return attachItems.map((item): Row => ({ kind: "attach", item }));
		}
		if (commandMode) {
			return "prompt".startsWith(value.slice(1).toLowerCase())
				? [{ kind: "command" }]
				: [];
		}
		if (!text) return [];
		if (verb) return [{ kind: "copy" }];
		return [
			...hits.map((item): Row => ({ kind: "hit", item })),
			{ kind: "to-prompt" },
		];
	}, [attachMode, attachItems, commandMode, value, text, verb, hits]);

	const open = focused && !dismissed && (rows.length > 0 || manual !== null);
	const activeId = open && !manual ? `${listId}-${selected}` : undefined;

	// ⌘K / Ctrl+K focuses this field; the palette yields on docs pages.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	function reset() {
		setValue("");
		setVerb(false);
		setChips([]);
		setManual(null);
		setSelected(0);
	}

	/** Signed-in readers' lists load the first time the field is focused. */
	function loadAccount() {
		if (!account || fetchedAccount.current) return;
		fetchedAccount.current = true;
		void refreshKeys();
		void refreshList().catch(() => {});
	}

	function attach(item: CommandItem) {
		setChips((c) => [...c, item]);
		setVerb(true);
		setValue((v) => v.replace(ATTACH, "$1"));
		setSelected(0);
	}

	function onChange(next: string) {
		setDismissed(false);
		setSelected(0);
		setManual(null);
		// "/prompt " turns into the verb chip, the rest stays as the task.
		if (!verb && PROMPT_VERB.test(next)) {
			setVerb(true);
			setValue(next.replace(PROMPT_VERB, ""));
			return;
		}
		setValue(next);
	}

	async function copyPrompt(task: string) {
		if (busy || !task) return;
		setBusy(true);
		let pageMd = "";
		try {
			const res = await fetch(markdownPath(pathname));
			if (res.ok) pageMd = await res.text();
		} catch {
			// Build without the page's notes.
		}
		const attached = chips
			.filter((c) => c.id.startsWith(WEBHOOK_PREFIX))
			.map((c) => c.id.slice(WEBHOOK_PREFIX.length));
		const summary = account
			? accountSummary({ keys, webhooks: list?.data ?? null, attached })
			: "";
		const prompt = buildPrompt({
			task,
			pageMd,
			pageUrl: `${SITE}${markdownPath(pathname)}`,
			extraUrls: chips.flatMap((c) => chipUrl(c) ?? []),
			account: summary || undefined,
			key: account ? keyHint(keys) : null,
		});
		const ok = await copyText(prompt);
		setBusy(false);
		if (ok) {
			toast(
				`Prompt copied · ${wordCount(prompt)} words${summary ? " · filled in from your account" : ""}`,
			);
			reset();
			inputRef.current?.blur();
		} else {
			setManual(prompt);
		}
	}

	function openItem(item: CommandItem) {
		recordSelection(item.id);
		reset();
		inputRef.current?.blur();
		if (!item.href) return;
		const [path, anchor] = item.href.split("#");
		if (path === pathname) jumpOnPage(anchor);
		else router.push(item.href);
	}

	function pick(row: Row | undefined) {
		if (!row) return;
		if (row.kind === "command") {
			setVerb(true);
			setValue("");
		} else if (row.kind === "attach") {
			attach(row.item);
		} else if (row.kind === "hit") {
			openItem(row.item);
		} else {
			void copyPrompt(text);
		}
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (!rows.length) return;
			e.preventDefault();
			setDismissed(false);
			setSelected((i) =>
				e.key === "ArrowDown"
					? Math.min(i + 1, rows.length - 1)
					: Math.max(i - 1, 0),
			);
		} else if (e.key === "Enter" || (e.key === "Tab" && commandMode)) {
			if (e.key === "Tab" && !rows.length) return;
			e.preventDefault();
			pick(rows[selected]);
		} else if (e.key === "Escape") {
			if (open) setDismissed(true);
			else inputRef.current?.blur();
		} else if (e.key === "Backspace" && !value) {
			if (chips.length) setChips((c) => c.slice(0, -1));
			else if (verb) setVerb(false);
		}
	}

	const reads = [
		"reads this page",
		...(chips.length ? [chips.map((c) => `@${c.label}`).join(" ")] : []),
		...(account ? ["your account"] : []),
	].join(" + ");

	const placeholder = verb
		? "Describe the task for your agent"
		: "Search, /prompt, @ for context";

	return (
		<div
			ref={rootRef}
			className="docs-search"
			data-docs-search=""
			data-open={open || undefined}
			onBlur={(e) => {
				if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
					setFocused(false);
				}
			}}
		>
			<div className="docs-search-field">
				<SearchIcon />
				{verb ? (
					<div className="docs-search-chips">
						<span className="docs-search-chip">
							/prompt
							<button
								type="button"
								aria-label="Remove /prompt"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => {
									setVerb(false);
									setChips([]);
									inputRef.current?.focus();
								}}
							>
								×
							</button>
						</span>
						{chips.map((chip) => (
							<span key={chip.id} className="docs-search-chip">
								<span
									className="docs-search-chip-label"
									title={`@${chip.label}`}
								>
									@{chip.label}
								</span>
								<button
									type="button"
									aria-label={`Remove @${chip.label}`}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() => {
										setChips((c) => c.filter((x) => x.id !== chip.id));
										inputRef.current?.focus();
									}}
								>
									×
								</button>
							</span>
						))}
					</div>
				) : null}
				<input
					ref={inputRef}
					type="text"
					role="combobox"
					autoComplete="off"
					spellCheck={false}
					aria-label="Search the docs"
					aria-expanded={open}
					aria-controls={listId}
					aria-activedescendant={activeId}
					placeholder={placeholder}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					onFocus={() => {
						setFocused(true);
						setDismissed(false);
						loadAccount();
					}}
					onKeyDown={onKeyDown}
				/>
				<span className="docs-search-keys" aria-hidden="true">
					<kbd>/</kbd>
					<kbd>@</kbd>
				</span>
			</div>
			{open ? (
				<div
					className="docs-search-menu"
					role="presentation"
					onMouseDown={(e) => {
						// Keep focus in the input while a row is clicked.
						if ((e.target as HTMLElement).tagName !== "TEXTAREA")
							e.preventDefault();
					}}
				>
					{manual !== null ? (
						<div className="docs-search-manual">
							<p>Copy blocked. Select the prompt and copy it by hand.</p>
							<textarea
								readOnly
								value={manual}
								rows={8}
								aria-label="Prompt"
								onFocus={(e) => e.currentTarget.select()}
							/>
						</div>
					) : (
						<>
							{!commandMode && !verb && !attachMode && hits.length === 0 ? (
								<p className="docs-search-empty">
									No page or section matches “{text}”.
								</p>
							) : null}
							{attachMode && rows.length === 0 ? (
								<p className="docs-search-empty">Nothing to attach.</p>
							) : null}
							{/* biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, focus stays in the input */}
							{/* biome-ignore lint/a11y/useSemanticElements: a custom combobox list, not a native select */}
							<div id={listId} role="listbox" aria-label="Suggestions">
								{rows.map((row, i) => (
									// biome-ignore lint/a11y/useFocusableInteractive: combobox pattern, focus stays in the input
									// biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard
									<div
										key={rowKey(row)}
										id={`${listId}-${i}`}
										// biome-ignore lint/a11y/useSemanticElements: a custom combobox row, not a native option
										role="option"
										aria-selected={i === selected}
										className="docs-search-opt"
										data-kind={row.kind}
										onMouseMove={() => setSelected(i)}
										onClick={() => pick(row)}
									>
										<RowBody row={row} text={text} reads={reads} />
									</div>
								))}
							</div>
						</>
					)}
					<p className="docs-search-hint" aria-hidden="true">
						<span>↑↓ move</span>
						<span>
							↵{" "}
							{attachMode
								? "attach"
								: verb
									? "copy"
									: commandMode
										? "pick"
										: "open"}
						</span>
						<span>esc close</span>
					</p>
				</div>
			) : null}
		</div>
	);
}

function rowKey(row: Row): string {
	return row.kind === "hit" || row.kind === "attach" ? row.item.id : row.kind;
}

function RowBody({
	row,
	text,
	reads,
}: {
	row: Row;
	text: string;
	reads: string;
}) {
	if (row.kind === "command") {
		return (
			<>
				<span className="docs-search-label mono">/prompt</span>
				<span className="docs-search-sub">
					Write a prompt for your coding agent
				</span>
			</>
		);
	}
	if (row.kind === "copy") {
		return (
			<>
				<span className="docs-search-label">Copy the prompt</span>
				<span className="docs-search-sub">{reads}</span>
				<span className="docs-search-meta">↵</span>
			</>
		);
	}
	if (row.kind === "to-prompt") {
		return (
			<>
				<span className="docs-search-label mono">/prompt</span>
				<span className="docs-search-sub">“{text}”</span>
				<span className="docs-search-meta">copies</span>
			</>
		);
	}
	return (
		<>
			<span className="docs-search-label">{row.item.label}</span>
			{row.item.sub ? (
				<span className="docs-search-sub mono">{row.item.sub}</span>
			) : null}
			{row.kind === "attach" && row.item.badge ? (
				<span className="docs-search-meta">{row.item.badge.text}</span>
			) : null}
		</>
	);
}
