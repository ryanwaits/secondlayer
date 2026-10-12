"use client";

import { GITHUB_URL } from "@/lib/site";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { docsNavPages } from "./nav";

/** The MCP client config from /docs/mcp, verbatim. */
export const MCP_CONFIG = `{
  "mcpServers": {
    "secondlayer": {
      "command": "npx",
      "args": ["-y", "@secondlayer/mcp"],
      "env": {
        "SECONDLAYER_API_URL": "https://api.secondlayer.tools",
        "SECONDLAYER_API_KEY": "<sk-sl_ key from /account/keys>"
      }
    }
  }
}`;

const SITE = "https://secondlayer.tools";
const FLASH_MS = 1500;

/** Where a docs route's source lives, relative to the app's (www) group. */
export function sourcePath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return `${route.slice(1)}/page.mdx`;
}

/** The page's markdown twin. The introduction has no slug of its own. */
export function markdownPath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return route === "/docs" ? "/docs/introduction.md" : `${route}.md`;
}

/** Chat apps that document a prefill link. Add a row here to add an app. */
export const CHAT_TARGETS = [
	{
		id: "claude",
		label: "Claude",
		href: (prompt: string) =>
			`https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
	},
	{
		id: "chatgpt",
		label: "ChatGPT",
		href: (prompt: string) =>
			`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
	},
	{
		id: "cursor",
		label: "Cursor",
		href: (prompt: string) =>
			`https://cursor.com/link/prompt?text=${encodeURIComponent(prompt)}`,
	},
] as const;

export function chatPrompt(pathname: string): string {
	return `Read ${SITE}${markdownPath(pathname)} and help me with secondlayer.`;
}

/** Last resort when the async clipboard API refuses: select + execCommand. */
function copyViaTextarea(text: string): boolean {
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.setAttribute("readonly", "");
	ta.style.position = "fixed";
	ta.style.opacity = "0";
	document.body.appendChild(ta);
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}
	document.body.removeChild(ta);
	return ok;
}

async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return copyViaTextarea(text);
	}
}

/** Fetch the page's markdown and put it on the clipboard. The fetch is handed
 *  to the clipboard as a pending item, so Safari still counts the write as
 *  part of the click; other browsers fall back to writeText, then a textarea. */
async function copyMarkdown(url: string): Promise<boolean> {
	const load = fetch(url)
		.then((res) => {
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return res.text();
		})
		// The route prefixes a `<!-- source: … -->` line; the page starts below it.
		.then((text) => text.replace(/^<!--[\s\S]*?-->\s*/, ""));
	if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/plain": load.then((t) => new Blob([t], { type: "text/plain" })),
				}),
			]);
			return true;
		} catch {
			// Fall through; a failed fetch rejects again below.
		}
	}
	return copyText(await load);
}

const ICON = {
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round",
	strokeLinejoin: "round",
} as const;

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg viewBox="0 0 16 16" aria-hidden="true" {...ICON}>
			{children}
		</svg>
	);
}

function Chevron() {
	return (
		<svg className="chev" viewBox="0 0 12 12" aria-hidden="true" {...ICON}>
			<path d="M3 4.5 6 7.5l3-3" />
		</svg>
	);
}

/** One expandable row: a button that discloses a panel directly below it. */
function Disclosure({
	label,
	icon,
	open,
	onToggle,
	compact,
	children,
}: {
	label: string;
	icon: ReactNode;
	open: boolean;
	onToggle: () => void;
	compact: boolean;
	children: ReactNode;
}) {
	const panelId = useId();
	return (
		<>
			<button
				type="button"
				className="docs-ra"
				aria-expanded={open}
				aria-controls={panelId}
				title={compact ? label : undefined}
				aria-label={compact ? label : undefined}
				onClick={onToggle}
			>
				{icon}
				<span>{label}</span>
				<Chevron />
			</button>
			<div className="docs-ra-sub" id={panelId} hidden={!open}>
				{children}
			</div>
		</>
	);
}

type Panel = "export" | "chat" | "mcp";

/**
 * Page actions: the rail's rows under "On this page" (and the phone
 * disclosure). Neutral rows; ink on hover. `fullView` adds the API
 * reference's layout toggle as the first row; `compact` is the icon-only
 * state, where every row keeps its label as a tooltip and accessible name.
 */
export function PageActions({
	fullView,
	compact = false,
}: {
	fullView?: { on: boolean; toggle: () => void };
	compact?: boolean;
}) {
	const pathname = usePathname();
	const [open, setOpen] = useState<Panel | null>(null);
	const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
	const [mcpCopied, setMcpCopied] = useState(false);
	const timers = useRef<number[]>([]);

	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const t of pending) clearTimeout(t);
		};
	}, []);

	const flash = (set: () => void, reset: () => void) => {
		set();
		timers.current.push(window.setTimeout(reset, FLASH_MS));
	};
	const toggle = (panel: Panel) =>
		setOpen((cur) => (cur === panel ? null : panel));
	const tip = (label: string) =>
		compact ? { title: label, "aria-label": label } : {};

	const md = markdownPath(pathname);
	// Only pages in the sidebar have a markdown twin (the changelog archive does
	// not), so the rows that point at one are left off elsewhere.
	const hasMarkdown = docsNavPages().some(
		(page) => page.href === pathname.replace(/\/$/, ""),
	);
	const prompt = chatPrompt(pathname);
	const copyLabel =
		copy === "done"
			? "Copied"
			: copy === "failed"
				? "Couldn't copy"
				: "Copy as Markdown";

	return (
		<section className="docs-acts" aria-label="Page actions">
			{fullView ? (
				<button
					type="button"
					className="docs-ra"
					aria-pressed={fullView.on}
					aria-keyshortcuts="F"
					title={`${fullView.on ? "Exit full view" : "Full view"} (F)`}
					onClick={fullView.toggle}
				>
					<Icon>
						{fullView.on ? (
							<path d="M13.5 6.5h-4v-4M9.5 6.5l4-4M2.5 9.5h4v4M6.5 9.5l-4 4M6.5 2.5v4h-4M6.5 6.5l-4-4M9.5 13.5v-4h4M9.5 9.5l4 4" />
						) : (
							<path d="M10 2.5h3.5V6M13.5 2.5 9.5 6.5M6 13.5H2.5V10M2.5 13.5l4-4M2.5 6V2.5H6M2.5 2.5l4 4M13.5 10v3.5H10M13.5 13.5l-4-4" />
						)}
					</Icon>
					<span>{fullView.on ? "Exit full view" : "Full view"}</span>
					<kbd className="docs-ra-key">F</kbd>
				</button>
			) : null}
			<a
				className="docs-ra"
				href={`${GITHUB_URL}/blob/main/apps/web/src/app/(www)/${sourcePath(pathname)}`}
				target="_blank"
				rel="noopener noreferrer"
				{...tip("Edit on GitHub")}
			>
				<svg className="gh" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M8 2.2a5.8 5.8 0 0 0-1.83 11.3c.29.05.4-.13.4-.28v-1c-1.62.35-1.96-.78-1.96-.78-.26-.67-.65-.85-.65-.85-.53-.36.04-.36.04-.36.59.04.9.6.9.6.52.9 1.37.64 1.7.49.05-.38.2-.64.37-.79-1.3-.15-2.66-.65-2.66-2.88 0-.64.23-1.16.6-1.57-.06-.15-.26-.74.06-1.54 0 0 .49-.16 1.6.6a5.5 5.5 0 0 1 2.9 0c1.11-.76 1.6-.6 1.6-.6.32.8.12 1.39.06 1.54.37.41.6.93.6 1.57 0 2.24-1.36 2.73-2.66 2.87.21.18.4.54.4 1.09v1.6c0 .16.1.34.4.28A5.8 5.8 0 0 0 8 2.2z" />
				</svg>
				<span>Edit on GitHub</span>
			</a>
			<button
				type="button"
				className="docs-ra"
				{...tip("Scroll to top")}
				onClick={() =>
					window.scrollTo({
						top: 0,
						behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
							.matches
							? "auto"
							: "smooth",
					})
				}
			>
				<Icon>
					<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
				</Icon>
				<span>Scroll to top</span>
			</button>
			{hasMarkdown ? (
				<button
					type="button"
					className="docs-ra"
					{...tip("Copy as Markdown")}
					onClick={async () => {
						const ok = await copyMarkdown(md).catch(() => false);
						flash(
							() => setCopy(ok ? "done" : "failed"),
							() => setCopy("idle"),
						);
					}}
				>
					<Icon>
						<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
						<path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
					</Icon>
					<span
						className={copy === "done" ? "ok" : copy === "failed" ? "bad" : ""}
						aria-live="polite"
					>
						{copyLabel}
					</span>
				</button>
			) : null}

			<Disclosure
				label="Export"
				icon={
					<Icon>
						<path d="M8 2.5v7M5 6.5l3 3 3-3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
					</Icon>
				}
				open={open === "export"}
				onToggle={() => toggle("export")}
				compact={compact}
			>
				{hasMarkdown ? (
					<a href={md} target="_blank" rel="noopener noreferrer">
						Markdown <span>{md}</span>
					</a>
				) : null}
				<a href="/llms.txt" target="_blank" rel="noopener noreferrer">
					llms.txt <span>site index</span>
				</a>
				<a href="/llms-full.txt" target="_blank" rel="noopener noreferrer">
					llms-full.txt <span>every page</span>
				</a>
			</Disclosure>

			{hasMarkdown ? (
				<Disclosure
					label="Open in chat"
					icon={
						<Icon>
							<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
						</Icon>
					}
					open={open === "chat"}
					onToggle={() => toggle("chat")}
					compact={compact}
				>
					{CHAT_TARGETS.map((t) => (
						<a
							key={t.id}
							href={t.href(prompt)}
							target="_blank"
							rel="noopener noreferrer"
						>
							{t.label}
						</a>
					))}
				</Disclosure>
			) : null}

			<Disclosure
				label="Connect to MCP"
				icon={
					<Icon>
						<path d="M5.5 2v3M10.5 2v3M4 5h8v2.5a4 4 0 0 1-8 0V5zM8 11.5V14" />
					</Icon>
				}
				open={open === "mcp"}
				onToggle={() => toggle("mcp")}
				compact={compact}
			>
				<div className="docs-mt">
					<div className="docs-mt-bar">
						<span>mcp.json</span>
						<button
							type="button"
							onClick={async () => {
								const ok = await copyText(MCP_CONFIG);
								if (ok)
									flash(
										() => setMcpCopied(true),
										() => setMcpCopied(false),
									);
							}}
						>
							{mcpCopied ? "Copied" : "Copy"}
						</button>
					</div>
					<pre>{MCP_CONFIG}</pre>
				</div>
				<p className="docs-ra-note">
					Key from <Link href="/account/keys">/account/keys</Link>. On your own
					box, see <Link href="/docs/mcp">MCP and skills</Link>.
				</p>
			</Disclosure>
		</section>
	);
}
