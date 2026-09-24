"use client";

import { type ReactNode, useEffect, useState } from "react";

const BASE_KEY = "apiref-base";
type Base = "hosted" | "local";

/**
 * Which base URL every cURL on the page targets. Both variants are rendered
 * on the server; this only flips `data-base` on the reference root, and CSS
 * shows the matching one. Remembered per viewer; storage is optional.
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
		document.querySelector(".apiref")?.setAttribute("data-base", base);
		try {
			localStorage.setItem(BASE_KEY, base);
		} catch {
			// Not persisted; the choice still applies to this visit.
		}
	}, [base]);

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

function CopyText({
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

const STICK_TOP = 110;
const STICK_BOTTOM = 24;

/**
 * Asides stick at the top, but one taller than the viewport would hide its
 * tail until the section ends. Those get a negative `top`, so they scroll with
 * the page until their bottom lands, then stick there.
 *
 * Sets `top` itself, not an inherited custom property: a custom property would
 * restyle every highlighted token under each aside (~55ms on this page). All
 * heights are read before any write, and unchanged values aren't rewritten.
 */
export function StickyAsides() {
	useEffect(() => {
		const asides = [...document.querySelectorAll<HTMLElement>(".apiref-aside")];
		const place = () => {
			const tops = asides.map(
				(aside) =>
					`${Math.min(STICK_TOP, window.innerHeight - aside.offsetHeight - STICK_BOTTOM)}px`,
			);
			asides.forEach((aside, i) => {
				if (aside.style.top !== tops[i]) aside.style.top = tops[i];
			});
		};
		const observer = new ResizeObserver(place);
		for (const aside of asides) observer.observe(aside);
		window.addEventListener("resize", place);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
		};
	}, []);
	return null;
}
