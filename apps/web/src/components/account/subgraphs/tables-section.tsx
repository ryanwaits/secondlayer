"use client";

import "@/components/code/code.css";
import { CodeScope } from "@/components/code/code-scope";
import { stripAnnotations } from "@/lib/code/annotations";
import type { RenderedBlock } from "@/lib/code/blocks";
import type {
	SubgraphSource,
	SubgraphSourceInfo,
	SubgraphTableInfo,
} from "@/lib/subgraphs-store";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Piece, tableCode } from "./describe-table";

/**
 * "Tables": one closed row per table, built like the webhook page's "Listens
 * for". Details opens a sentence whose phrases are click-to-press focus
 * links, above the table's real handler source in the docs code frame. The
 * frame is rendered on the server because Shiki doesn't run in the browser:
 * the page render hands the frames in (`initialBlocks`), and `/api/code`
 * renders them again when the subgraph's version changes.
 */

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

export function TablesSection({
	name,
	tables,
	sources,
	source,
	initialBlocks,
}: {
	name: string;
	tables: Record<string, SubgraphTableInfo>;
	sources: Record<string, SubgraphSourceInfo> | undefined;
	/** Null while the source loads or when it is unavailable. */
	source: SubgraphSource | null;
	/** The frames the server rendered for this subgraph's current version. */
	initialBlocks?: RenderedBlock[] | null;
}) {
	const sourceCode = source?.sourceCode ?? null;
	const { descriptions, blocks } = useMemo(
		() => tableCode({ name, tables, sources, sourceCode }),
		[name, tables, sources, sourceCode],
	);

	// Frames go out for the tables that have code, in row order, up to the cap.
	const blockIndex = (table: string): number =>
		descriptions
			.filter((d) => d.description.code !== null)
			.findIndex((d) => d.table === table);

	const key = source ? `${name}:${source.updatedAt}` : null;
	// The version the server's frames belong to; a newer version refetches.
	const seededKey = useRef(initialBlocks ? key : null);
	const [rendered, setRendered] = useState<RenderedBlock[] | null>(
		initialBlocks ?? null,
	);
	const [open, setOpen] = useState<Set<string>>(() => new Set());

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when the subgraph's version changes, not on every poll
	useEffect(() => {
		if (seededKey.current === key) return;
		if (!key || blocks.length === 0) {
			setRendered(null);
			return;
		}
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

	const toggle = (table: string) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(table)) next.add(table);
			return next;
		});

	return (
		<section className="lf" aria-label="Tables">
			<div className="lf-h">
				<span className="dash-label">Tables</span>
				<span className="lf-count">
					{descriptions.length} table{descriptions.length === 1 ? "" : "s"}
				</span>
			</div>
			<div className="lf-rows">
				{descriptions.map(({ table, description }) => {
					const isOpen = open.has(table);
					const index = blockIndex(table);
					const block = index >= 0 ? rendered?.[index] : undefined;
					return (
						<div className="lf-trig" key={table}>
							<button
								type="button"
								className="lf-row"
								aria-expanded={isOpen}
								onClick={() => toggle(table)}
							>
								<span className="lf-type">{table}</span>
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
								</p>
								{block ? (
									<div
										className={block.className}
										data-copyable={block.copyable ? "" : undefined}
										// biome-ignore lint/security/noDangerouslySetInnerHtml: built by `renderCode` on the server, which escapes every dynamic value
										dangerouslySetInnerHTML={{ __html: block.html }}
									/>
								) : description.code ? (
									<pre className="lf-pre">
										{stripAnnotations(description.code, "ts")}
									</pre>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
			<CodeScope />
		</section>
	);
}
