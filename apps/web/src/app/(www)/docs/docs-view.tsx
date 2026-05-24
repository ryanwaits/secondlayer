"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { AgentView } from "./agent-view";
import { useDocsMode } from "./docs-mode";
import { DOCS_NAV } from "./nav";

function lookup(pathname: string) {
	for (const group of DOCS_NAV) {
		for (const item of group.items) {
			if (item.href === pathname)
				return { group: group.label, title: item.title };
		}
	}
	return null;
}

function CopyPageButton() {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="docs-copy-page"
			onClick={() => {
				const el = document.getElementById("docs-article");
				if (!el) return;
				navigator.clipboard.writeText(el.innerText);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				aria-hidden="true"
			>
				<rect x="5" y="5" width="9" height="9" rx="1.5" />
				<path d="M5 11H3.5A1.5 1.5 0 0 1 2 9.5V3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5V5" />
			</svg>
			{copied ? "Copied" : "Copy page"}
		</button>
	);
}

/** Switches the docs body between the human reading view (MDX) and the
 *  agent-doc view, and renders the breadcrumb + copy-page chrome for human mode. */
export function DocsView({ children }: { children: ReactNode }) {
	const { mode } = useDocsMode();
	const pathname = usePathname();
	const info = lookup(pathname);

	if (mode === "agent") {
		return <AgentView slug={pathname} title={info?.title ?? "Docs"} />;
	}

	return (
		<>
			<div className="docs-topline">
				{info && (
					<span className="docs-crumb">
						{info.group} <span className="sep">/</span> {info.title}
					</span>
				)}
				<CopyPageButton />
			</div>
			<article className="docs-article" id="docs-article">
				{children}
			</article>
		</>
	);
}
