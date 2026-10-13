"use client";

import { type ReactNode, useEffect, useState } from "react";
import { resolveAnchor } from "./resolve-anchor";

const BASE_KEY = "apiref-base";
type Base = "hosted" | "local";

/**
 * Which base URL every cURL on the page targets. Both variants are rendered
 * on the server; this only flips `data-base` on the page root, and CSS
 * shows the matching one, in the page and in the drawer (which sits outside
 * the reference). Remembered per viewer; storage is optional.
 */
export function BaseUrlSwitch() {
	const [base, setBase] = useState<Base>("hosted");

	useEffect(() => {
		try {
			const saved = localStorage.getItem(BASE_KEY);
			if (saved === "hosted" || saved === "local") setBase(saved);
		} catch {
			// Private windows and blocked storage fall back to hosted.
		}
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-base", base);
		try {
			localStorage.setItem(BASE_KEY, base);
		} catch {
			// Not persisted; the choice still applies to this visit.
		}
	}, [base]);

	useEffect(
		() => () => document.documentElement.removeAttribute("data-base"),
		[],
	);

	return (
		<label className="apiref-base">
			<span>Base URL</span>
			<select
				value={base}
				onChange={(e) => setBase(e.target.value as Base)}
				aria-label="Base URL for examples"
			>
				<option value="hosted">api.secondlayer.tools</option>
				<option value="local">127.0.0.1:3800</option>
			</select>
		</label>
	);
}

/** cURL / SDK tabs over server-rendered panels. */
export function CodeTabs({
	labels,
	panels,
	copyText,
}: {
	labels: string[];
	panels: ReactNode[];
	copyText: string[];
}) {
	const [active, setActive] = useState(0);
	return (
		<div className="apiref-request">
			<div className="apiref-request-bar" role="tablist">
				{labels.map((label, i) => (
					<button
						key={label}
						type="button"
						role="tab"
						aria-selected={active === i}
						className="apiref-tab"
						onClick={() => setActive(i)}
					>
						{label}
					</button>
				))}
				<CopyText
					text={copyText[active] ?? ""}
					label="Copy request"
					className="apiref-request-copy"
				/>
			</div>
			{panels.map((panel, i) => (
				<div
					key={labels[i]}
					role="tabpanel"
					hidden={active !== i}
					className="apiref-request-body"
				>
					{panel}
				</div>
			))}
		</div>
	);
}

/**
 * Copy text that is fetched on click. The fetch is handed to the clipboard as
 * a pending item, so Safari still counts the write as part of the click.
 */
async function copyFetched(url: string): Promise<void> {
	const text = () =>
		fetch(url).then((res) => {
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return res.text();
		});
	if (typeof ClipboardItem !== "undefined") {
		const blob = text().then((t) => new Blob([t], { type: "text/plain" }));
		await navigator.clipboard.write([
			new ClipboardItem({ "text/plain": blob }),
		]);
		return;
	}
	await navigator.clipboard.writeText(await text());
}

export function CopyText({
	text,
	fetchFrom,
	label,
	className,
	children,
}: {
	/** The text itself, or (fetchFrom) a URL to fetch it from on click. */
	text?: string;
	fetchFrom?: string;
	label: string;
	className?: string;
	children?: ReactNode;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={className}
			aria-label={children ? undefined : label}
			onClick={() => {
				const write = fetchFrom
					? copyFetched(fetchFrom)
					: navigator.clipboard.writeText(text ?? "");
				write.then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1400);
				});
			}}
		>
			{children ? (
				copied ? (
					"Copied"
				) : (
					children
				)
			) : (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					{copied ? (
						<path d="M5 12.5 10 17.5 19 7" />
					) : (
						<>
							<rect x="8" y="8" width="12" height="12" rx="2" />
							<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
						</>
					)}
				</svg>
			)}
		</button>
	);
}

/**
 * The reference used to be one page, with an anchor per endpoint. A link
 * that still carries one (`/docs/api-reference#list-pox5-events`) lands here;
 * the hash isn't sent to the server, so this moves it to the API page that
 * holds the anchor, where the drawer opens it. No hash, or one that names no
 * endpoint, stays on the index.
 */
export function ApiHashRedirect({
	owners,
}: { owners: Record<string, string> }) {
	useEffect(() => {
		const go = () => {
			const anchor = resolveAnchor(owners, location.hash);
			if (anchor)
				location.replace(`/docs/api/${owners[anchor]}${location.hash}`);
		};
		go();
		window.addEventListener("hashchange", go);
		return () => window.removeEventListener("hashchange", go);
	}, [owners]);
	return null;
}

/** The prompt to hand a coding agent for one endpoint, copyable as plain text. */
export function PromptBlock({ text }: { text: string }) {
	return (
		<div className="apiref-prompt">
			<div className="apiref-prompt-bar">
				<span>Prompt for your agent</span>
				<CopyText
					text={text}
					label="Copy prompt"
					className="apiref-prompt-copy"
				>
					Copy
				</CopyText>
			</div>
			<pre className="apiref-prompt-text">{text}</pre>
		</div>
	);
}

/** Copy link · Copy as Markdown · Open .md, for one section. */
export function SectionActions({ anchor }: { anchor: string }) {
	// The section's markdown twin, served statically by the docs .md route;
	// fetched on click rather than shipped inline for all ~120 sections.
	const mdHref = `/docs/api-reference/${anchor}.md`;
	const [linked, setLinked] = useState(false);
	return (
		<div className="apiref-actions">
			<button
				type="button"
				onClick={() => {
					const url = `${location.origin}${location.pathname}#${anchor}`;
					navigator.clipboard.writeText(url);
					history.replaceState(history.state, "", `#${anchor}`);
					setLinked(true);
					setTimeout(() => setLinked(false), 1400);
				}}
			>
				{linked ? "Link copied" : "Copy link"}
			</button>
			<CopyText fetchFrom={mdHref} label="Copy as Markdown">
				Copy as Markdown
			</CopyText>
			<a href={mdHref}>Open .md</a>
		</div>
	);
}

/**
 * Long examples preview their first lines and expand in place. The block
 * never scrolls vertically, so the wheel always moves its container.
 */
export function ExpandableCode({
	lines,
	children,
}: {
	lines: number;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div className="apiref-long" data-open={open ? "true" : undefined}>
			{children}
			{open ? null : (
				<button
					type="button"
					className="apiref-expand"
					onClick={() => setOpen(true)}
				>
					Show all {lines} lines
				</button>
			)}
		</div>
	);
}
