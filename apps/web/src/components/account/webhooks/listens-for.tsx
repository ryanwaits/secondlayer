"use client";

import "@/components/code/code.css";
import { CodeScope } from "@/components/code/code-scope";
import { useChainTip } from "@/lib/chain-tip";
import { stripAnnotations } from "@/lib/code/annotations";
import type { RenderedBlock } from "@/lib/code/blocks";
import { useCopied } from "@/lib/use-copied";
import type { WebhookActivity, WebhookDetail } from "@secondlayer/sdk";
import { useEffect, useRef, useState } from "react";
import { type Piece, agentPrompt, listensForCode } from "./describe-trigger";

/**
 * "Listens for": one closed row per trigger. Details opens the docs-style
 * section: a sentence whose phrases are focus links, then that trigger's code
 * in the docs frame. Shiki doesn't run in the browser, so the page render
 * hands the frames in (`initialBlocks`) and `/api/code` renders them again
 * when the webhook's version changes.
 */

const COPIED_MS = 1200;

function Pieces({ pieces }: { pieces: Piece[] }) {
	return pieces.map((piece, i) =>
		piece.code ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: pieces are static per render
			<code key={i}>{piece.text}</code>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: pieces are static per render
			<span key={i}>{piece.text}</span>
		),
	);
}

export function ListensFor({
	webhook,
	activity,
	initialBlocks,
}: {
	webhook: WebhookDetail;
	activity: WebhookActivity | null;
	/** The frames the server rendered for this webhook's current version. */
	initialBlocks?: RenderedBlock[] | null;
}) {
	const { triggers } = webhook;
	const { descriptions, blocks } = listensForCode(webhook, activity);
	const key = `${webhook.id}:${webhook.updatedAt}`;
	// The version the server's frames belong to; a newer version refetches.
	const seededKey = useRef(initialBlocks ? key : null);
	const [rendered, setRendered] = useState<RenderedBlock[] | null>(
		initialBlocks ?? null,
	);
	const [open, setOpen] = useState<Set<number>>(() => new Set());
	const { copied, copy: copyPrompt } = useCopied(COPIED_MS);
	const peek = useRef<HTMLDetailsElement>(null);
	const peekText = useRef<HTMLPreElement>(null);
	const height = useChainTip().height;
	const prompt = agentPrompt(webhook, height);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when the webhook's version changes, not on every poll
	useEffect(() => {
		if (seededKey.current === key) return;
		setRendered(null);
		let live = true;
		fetch("/api/code", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ blocks }),
		})
			.then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
			.then((body: { blocks: RenderedBlock[] }) => {
				if (live) setRendered(body.blocks);
			})
			.catch(() => {
				// The plain code below stays: the section never depends on this.
			});
		return () => {
			live = false;
		};
	}, [key]);

	const toggle = (index: number) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(index)) next.add(index);
			return next;
		});

	async function copy() {
		if (await copyPrompt(prompt)) return;
		// No clipboard access: show the text, selected, to copy by hand.
		const details = peek.current;
		const text = peekText.current;
		if (!details || !text) return;
		details.open = true;
		const range = document.createRange();
		range.selectNodeContents(text);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	return (
		<section className="lf" aria-label="Listens for">
			<div className="lf-h">
				<span className="dash-label">Listens for</span>
				<span className="lf-count">
					{triggers.length} trigger
					{triggers.length > 1 ? "s, either one fires" : ""}
				</span>
			</div>
			<div className="lf-rows">
				{triggers.map((trigger, i) => {
					const description = descriptions[i];
					if (!description) return null;
					const block = rendered?.[i];
					const isOpen = open.has(i);
					return (
						// Triggers have no stable id; position is fine, the list never reorders.
						// biome-ignore lint/suspicious/noArrayIndexKey: triggers are static per webhook
						<div className="lf-trig" key={i}>
							<button
								type="button"
								className="lf-row"
								aria-expanded={isOpen}
								onClick={() => toggle(i)}
							>
								<span className="lf-type">{trigger.type}</span>
								<span className="lf-line">
									<Pieces pieces={description.line} />
								</span>
								<span className="lf-toggle">{isOpen ? "Hide" : "Details"}</span>
							</button>
							<div className="lf-det" data-scope hidden={!isOpen}>
								<p className="lf-prose">
									{description.prose.map((segment, s) =>
										segment.focus ? (
											<button
												// biome-ignore lint/suspicious/noArrayIndexKey: segments are static per render
												key={s}
												type="button"
												className="flink"
												data-focus={segment.focus}
												aria-pressed="false"
											>
												<Pieces pieces={segment.pieces} />
											</button>
										) : (
											// biome-ignore lint/suspicious/noArrayIndexKey: segments are static per render
											<Pieces key={s} pieces={segment.pieces} />
										),
									)}
									{description.tail ? ` ${description.tail}` : null}
								</p>
								{block ? (
									<div
										className={block.className}
										data-copyable={block.copyable ? "" : undefined}
										// biome-ignore lint/security/noDangerouslySetInnerHtml: built by `renderCode` on the server, which escapes every dynamic value
										dangerouslySetInnerHTML={{ __html: block.html }}
									/>
								) : (
									<pre className="lf-pre">
										{stripAnnotations(description.source, "ts")}
									</pre>
								)}
							</div>
						</div>
					);
				})}
			</div>
			<div className="lf-foot">
				<p className="lf-note">
					Want to change something? Copy this webhook's details and the right
					commands into your agent, then tell it what you want. It asks before
					it runs anything.
				</p>
				<button type="button" className="acct-btn line small" onClick={copy}>
					{copied ? "Copied" : "Copy for agent"}
				</button>
			</div>
			<details className="lf-peek" ref={peek}>
				<summary>What gets copied</summary>
				<pre ref={peekText}>{prompt}</pre>
			</details>
			<CodeScope />
		</section>
	);
}
