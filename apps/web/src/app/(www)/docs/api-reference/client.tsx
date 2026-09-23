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

function CopyText({
	text,
	label,
	className,
	children,
}: {
	text: string;
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
				navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1400);
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
export function SectionActions({
	anchor,
	markdown,
	mdHref,
}: {
	anchor: string;
	markdown: string;
	mdHref?: string;
}) {
	const [linked, setLinked] = useState(false);
	return (
		<div className="apiref-actions">
			<button
				type="button"
				onClick={() => {
					const url = `${location.origin}${location.pathname}#${anchor}`;
					navigator.clipboard.writeText(url);
					history.replaceState(null, "", `#${anchor}`);
					setLinked(true);
					setTimeout(() => setLinked(false), 1400);
				}}
			>
				{linked ? "Link copied" : "Copy link"}
			</button>
			<CopyText text={markdown} label="Copy as Markdown">
				Copy as Markdown
			</CopyText>
			{mdHref ? <a href={mdHref}>Open .md</a> : null}
		</div>
	);
}
