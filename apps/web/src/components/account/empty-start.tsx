"use client";

import { CheckIcon, CopyIcon } from "@/components/copy-button";
import { useCopied } from "@/lib/use-copied";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";

export interface Guide {
	title: string;
	description: string;
	href: string;
}

export function EmptyStart({
	children,
	guides,
	docsHref,
	docsLabel,
}: {
	children: ReactNode;
	guides: readonly Guide[];
	docsHref: string;
	docsLabel: string;
}) {
	const headingId = useId();
	return (
		<div className="empty-start">
			<div className="empty-start-main">{children}</div>
			<aside className="empty-start-guides" aria-labelledby={headingId}>
				<div className="empty-guides-head">
					<h2 id={headingId}>Guides</h2>
					<Link href={docsHref} className="dash-link">
						{docsLabel} ›
					</Link>
				</div>
				<ul className="empty-guides">
					{guides.map((guide) => (
						<li key={guide.href}>
							<Link href={guide.href}>
								<span>
									<span className="empty-guide-title">{guide.title}</span>
									<span className="empty-guide-desc">{guide.description}</span>
								</span>
								<span className="empty-guide-arrow" aria-hidden="true">
									›
								</span>
							</Link>
						</li>
					))}
				</ul>
			</aside>
		</div>
	);
}

const COPIED_MS = 1800;

export function CopyForAgent({
	prompt,
	hint,
}: { prompt: string; hint: string }) {
	const { copied, copy } = useCopied(COPIED_MS);

	return (
		<div className="copy-agent">
			<button
				type="button"
				className="acct-btn solid copy-agent-btn"
				onClick={() => copy(prompt)}
			>
				<span className="copy-agent-icon">
					{copied ? <CheckIcon /> : <CopyIcon />}
				</span>
				Copy for agent
			</button>
			<span className="copy-agent-hint" aria-live="polite">
				{copied ? "Copied. Paste it into Claude Code, Cursor or Codex." : hint}
			</span>
		</div>
	);
}
