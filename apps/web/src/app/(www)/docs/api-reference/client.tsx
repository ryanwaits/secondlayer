"use client";

import {
	BASE_SWAPS,
	type Base,
	HOSTED_BASE,
	LOCAL_BASE,
} from "@/lib/code/base-url";
import { Fragment, type ReactNode, useEffect, useId, useState } from "react";
import type { PromptPart } from "./prompt";
import { resolveAnchor } from "./resolve-anchor";

const BASE_KEY = "apiref-base";

function applyBase(scope: ParentNode, base: Base) {
	for (const el of scope.querySelectorAll<HTMLElement>("[data-swap]")) {
		const swap = BASE_SWAPS[Number(el.dataset.swap)];
		if (!swap) continue;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let first = true;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			n.nodeValue = first ? swap[base === "local" ? 1 : 0] : "";
			first = false;
		}
	}
}

export function BaseUrlSwitch() {
	const [base, setBase] = useState<Base>("hosted");

	useEffect(() => {
		try {
			const saved = localStorage.getItem(BASE_KEY);
			if (saved === "hosted" || saved === "local") setBase(saved);
		} catch {}
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-base", base);
		try {
			localStorage.setItem(BASE_KEY, base);
		} catch {}
		applyBase(document, base);
		const arrivals = new MutationObserver((records) => {
			for (const record of records)
				for (const node of record.addedNodes)
					if (node instanceof Element) applyBase(node, base);
		});
		arrivals.observe(document.body, { childList: true, subtree: true });
		return () => arrivals.disconnect();
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
	getText,
	fetchFrom,
	label,
	className,
	children,
}: {
	text?: string;
	getText?: () => string;
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
					: navigator.clipboard.writeText(getText ? getText() : (text ?? ""));
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
 * holds the anchor, where the section sits. No hash, or one that names no
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

export function PromptBar({
	text,
	parts,
}: { text: string; parts: PromptPart[] }) {
	const id = useId();
	const [open, setOpen] = useState(false);
	return (
		<div className="apiref-prompt" data-open={open ? "" : undefined}>
			<div className="apiref-prompt-bar">
				<span className="apiref-prompt-label">Agent prompt</span>
				<button
					type="button"
					className="apiref-prompt-toggle"
					aria-expanded={open}
					aria-controls={id}
					onClick={() => setOpen(!open)}
				>
					{open ? "Hide" : "Show"}
				</button>
				<CopyText
					text={text}
					label="Copy prompt"
					className="apiref-prompt-copy"
				>
					Copy prompt
				</CopyText>
			</div>
			<pre id={id} className="apiref-prompt-text" hidden={!open}>
				{parts.map((part, i) =>
					part.href ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: static split of an immutable prompt
						<a key={i} href={part.href}>
							{part.text}
						</a>
					) : part.strong ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: static split of an immutable prompt
						<b key={i}>{part.text}</b>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: static split of an immutable prompt
						<Fragment key={i}>{part.text}</Fragment>
					),
				)}
			</pre>
		</div>
	);
}

export function CopyUrl({ path }: { path: string }) {
	return (
		<CopyText
			label="Copy URL"
			className="apiref-copy-url"
			getText={() =>
				(document.documentElement.getAttribute("data-base") === "local"
					? LOCAL_BASE
					: HOSTED_BASE) + path
			}
		/>
	);
}

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
