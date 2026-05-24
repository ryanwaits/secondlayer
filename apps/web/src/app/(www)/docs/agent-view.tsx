"use client";

import { AGENT_SETUP } from "@/lib/agent-prompts";
import { useState } from "react";
import { type DocsAgentCard, docsAgentCards } from "./agent-content";

const SKILL_REPO = "https://github.com/ryanwaits/secondlayer";

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Render an agent prompt: `backtick` commands in accent, leading "- " muted. */
function formatPrompt(text: string) {
	return esc(text)
		.replace(/`([^`]+)`/g, '<span class="cmd">$1</span>')
		.replace(/^- /gm, '<span class="dash">-</span> ');
}

function CopyButton({
	text,
	label = "Copy",
	className = "agent-btn",
	onClick,
}: {
	text: string;
	label?: string;
	className?: string;
	onClick?: (e: React.MouseEvent) => void;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className={className}
			onClick={(e) => {
				onClick?.(e);
				navigator.clipboard.writeText(text);
				setCopied(true);
				setTimeout(() => setCopied(false), 1400);
			}}
		>
			{copied ? "✓ Copied" : label}
		</button>
	);
}

/** Clicking the card body reveals the full prompt; Copy is always visible. */
function PromptCard({ card }: { card: DocsAgentCard }) {
	const [open, setOpen] = useState(false);
	return (
		<div className={`agent-card${open ? " open" : ""}`}>
			<div className="agent-card-row">
				{/* Stretched cover button toggles the card; copy stays a sibling to avoid nested <button>. */}
				<button
					type="button"
					className="agent-card-toggle"
					aria-expanded={open}
					aria-label={`${open ? "Hide" : "Show"} full prompt for ${card.title}`}
					onClick={() => setOpen((o) => !o)}
				/>
				<span className="agent-card-text">
					<span className="apc-title">{card.title}</span>
					<span className="apc-desc">{card.description}</span>
				</span>
				<span className="apc-actions">
					<CopyButton
						text={card.prompt}
						label="Copy prompt"
						className="agent-btn apc-copy"
					/>
					<span className="apc-chevron" aria-hidden="true">
						›
					</span>
				</span>
			</div>
			{open && (
				<pre
					className="agent-card-full"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: locally-built prompt string, escaped in formatPrompt
					dangerouslySetInnerHTML={{ __html: formatPrompt(card.prompt) }}
				/>
			)}
		</div>
	);
}

export function AgentView({ slug, title }: { slug: string; title: string }) {
	const cards = docsAgentCards(slug);
	return (
		<section className="agent-view">
			<h1 className="agent-h1">
				<span className="hash">#</span>
				{title} · Agent Mode
			</h1>
			<p className="agent-by">
				<span className="sigil">%</span> Built for Codex, Claude Code, Cursor
				&amp; friends
			</p>
			<div className="agent-actions">
				<CopyButton text={AGENT_SETUP} label="⧉ Copy setup prompt" />
				<a
					className="agent-btn"
					href={SKILL_REPO}
					target="_blank"
					rel="noreferrer"
				>
					↗ Open skill repo
				</a>
			</div>

			<hr className="agent-rule" />

			<div className="agent-sec">
				<div className="agent-sec-title">
					<span className="hash">##</span> Set up once
				</div>
				<p className="agent-sec-sub">
					Paste into your agent. It skips any step already done.
				</p>
				<div className="agent-block">
					<div className="agent-block-head">
						<span className="agent-block-label">install · auth · instance</span>
						<CopyButton text={AGENT_SETUP} label="Copy" className="ic-copy" />
					</div>
					<pre
						// biome-ignore lint/security/noDangerouslySetInnerHtml: AGENT_SETUP is a local constant, escaped in formatPrompt
						dangerouslySetInnerHTML={{ __html: formatPrompt(AGENT_SETUP) }}
					/>
				</div>
			</div>

			<div className="agent-sec">
				<div className="agent-sec-title">
					<span className="hash">##</span> Prompts
				</div>
				<p className="agent-sec-sub">
					Copy a starter prompt, or open one to read the full instructions.
				</p>
				<div className="agent-cards">
					{cards.map((c) => (
						<PromptCard key={c.title} card={c} />
					))}
				</div>
			</div>
		</section>
	);
}
