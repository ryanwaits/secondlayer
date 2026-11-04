"use client";

import "@/components/code/code.css";
import { CodeScope } from "@/components/code/code-scope";
import { useMediaQuery } from "@/components/figures/use-media-query";
import { stripAnnotations } from "@/lib/code/annotations";
import type { RenderedBlock } from "@/lib/code/blocks";
import type {
	SubgraphSource,
	SubgraphSourceInfo,
	SubgraphTableInfo,
} from "@/lib/subgraphs-store";
import NumberFlow from "@number-flow/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { type Piece, type TableDescription, tableCode } from "./describe-table";

/**
 * "Tables": one small card per table with its live row count. Details opens
 * full width under the card's grid row: a sentence whose phrases are
 * click-to-press focus links, above the table's real handler source in the
 * docs code frame. Card order is frozen per subgraph version, so nothing jumps
 * while counts change. The frame is rendered on the server because Shiki
 * doesn't run in the browser: the page render hands the frames in
 * (`initialBlocks`), and `/api/code` renders them again when the subgraph's
 * version changes.
 */

/**
 * Table names in card order: the names of the previous order that still exist,
 * then any new tables, biggest first. With no previous order, biggest first.
 */
export function frozenOrder(
	prev: readonly string[] | null,
	tables: Record<string, SubgraphTableInfo>,
): string[] {
	const biggestFirst = Object.keys(tables).sort(
		(a, b) => (tables[b]?.rowCount ?? 0) - (tables[a]?.rowCount ?? 0),
	);
	if (!prev) return biggestFirst;
	const kept = prev.filter((table) => table in tables);
	return [...kept, ...biggestFirst.filter((table) => !kept.includes(table))];
}

/** Index of the card the open table's details follow: the last card in its grid row. */
export function detailsAfter(
	openIndex: number,
	perRow: number,
	count: number,
): number {
	return Math.min(
		count - 1,
		Math.floor(openIndex / perRow) * perRow + perRow - 1,
	);
}

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

/** The open card's panel: the sentence with its focus links, above the handler code. */
export function TableDetails({
	description,
	block,
}: {
	description: TableDescription | undefined;
	/** The server-rendered frame, when it has arrived. */
	block: RenderedBlock | undefined;
}) {
	if (!description) return null;
	return (
		<div className="lf-det tc-det" data-scope>
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
				<pre className="lf-pre">{stripAnnotations(description.code, "ts")}</pre>
			) : null}
		</div>
	);
}

export function TablesSection({
	name,
	tables,
	sources,
	source,
	initialBlocks,
	onOpen,
}: {
	name: string;
	tables: Record<string, SubgraphTableInfo>;
	sources: Record<string, SubgraphSourceInfo> | undefined;
	/** Null while the source loads or when it is unavailable. */
	source: SubgraphSource | null;
	/** The frames the server rendered for this subgraph's current version. */
	initialBlocks?: RenderedBlock[] | null;
	/** Called with the table that was opened, or null when it closed. */
	onOpen?: (table: string | null) => void;
}) {
	const sourceCode = source?.sourceCode ?? null;
	const { descriptions, blocks } = useMemo(
		() => tableCode({ name, tables, sources, sourceCode }),
		[name, tables, sources, sourceCode],
	);

	// Card order holds for a subgraph version: counts move, cards don't.
	const orderKey = `${name}:${source?.updatedAt ?? ""}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-sort only when the version changes, not on every poll
	const baseOrder = useMemo(() => frozenOrder(null, tables), [orderKey]);
	const order = useMemo(
		() => frozenOrder(baseOrder, tables),
		[baseOrder, tables],
	);

	// The tables the frames belong to, in the order the frames were made.
	const codeTables = descriptions
		.filter((d) => d.description.code !== null)
		.slice(0, blocks.length)
		.map((d) => d.table);
	const frameTables = useRef(codeTables);

	const key = source ? `${name}:${source.updatedAt}` : null;
	// The version the server's frames belong to; a newer version refetches.
	const seededKey = useRef(initialBlocks ? key : null);
	const [rendered, setRendered] = useState<RenderedBlock[] | null>(
		initialBlocks ?? null,
	);
	const [open, setOpen] = useState<string | null>(null);
	const narrow = useMediaQuery("(max-width: 860px)");
	const phone = useMediaQuery("(max-width: 520px)");
	const perRow = phone ? 1 : narrow ? 2 : 3;

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch only when the subgraph's version changes, not on every poll
	useEffect(() => {
		if (seededKey.current === key) return;
		frameTables.current = codeTables;
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

	const toggle = (table: string) => {
		const next = open === table ? null : table;
		setOpen(next);
		onOpen?.(next);
	};

	const described = new Map(descriptions.map((d) => [d.table, d.description]));
	const openIndex = open === null ? -1 : order.indexOf(open);
	const after =
		openIndex < 0 ? -1 : detailsAfter(openIndex, perRow, order.length);

	return (
		<section className="lf" aria-label="Tables">
			<div className="lf-h">
				<span className="dash-label">Tables</span>
				<span className="lf-count">
					{order.length} table{order.length === 1 ? "" : "s"}
				</span>
			</div>
			<div className="tc-grid">
				{order.map((table, i) => (
					<Fragment key={table}>
						<button
							type="button"
							className="tc-card"
							aria-expanded={open === table}
							onClick={() => toggle(table)}
						>
							<span className="tc-top">
								<span className="tc-name">{table}</span>
								<span className="tc-toggle">
									{open === table ? "Hide" : "Details"}
								</span>
							</span>
							<span className="tc-count">
								<NumberFlow
									value={tables[table]?.rowCount ?? 0}
									locales="en-US"
								/>{" "}
								<small>rows</small>
							</span>
						</button>
						{open !== null && i === after ? (
							<TableDetails
								description={described.get(open)}
								block={rendered?.[frameTables.current.indexOf(open)]}
							/>
						) : null}
					</Fragment>
				))}
			</div>
			<CodeScope />
		</section>
	);
}
