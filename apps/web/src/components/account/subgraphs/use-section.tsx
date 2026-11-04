"use client";

import "@/components/code/code.css";
import { MAX_CODE_BLOCKS, type RenderedBlock } from "@/lib/code/blocks";
import type { SubgraphTableInfo } from "@/lib/subgraphs-store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Fence,
	type Lang,
	RECIPES,
	type Recipe,
	copyText,
	exampleFence,
} from "./use-examples";

/**
 * "Use in your app": how to read one table from your own code. A chip per
 * table, four recipes, and the code as the SDK, the CLI or cURL, written from
 * the table's real columns and its newest row. The code frame is rendered by
 * the docs code renderer on the server (`/api/code`), because Shiki doesn't
 * run in the browser; the plain code shows until it arrives.
 */

const LANGS: readonly { id: Lang; label: string }[] = [
	{ id: "sdk", label: "SDK" },
	{ id: "cli", label: "CLI" },
	{ id: "curl", label: "cURL" },
];

const COPIED_MS = 1200;

type Sample = Record<string, unknown> | null;

async function readSample(name: string, table: string): Promise<Sample> {
	try {
		const res = await fetch(
			`/api/subgraphs/${encodeURIComponent(name)}/rows/${encodeURIComponent(table)}?_limit=1&_order=desc`,
		);
		if (!res.ok) return null;
		const body = (await res.json()) as { rows?: Record<string, unknown>[] };
		return body.rows?.[0] ?? null;
	} catch {
		return null;
	}
}

const fenceKeyOf = (fence: Fence): string => `${fence.lang}\n${fence.code}`;

/** Renders fences with the docs code renderer, in as few requests as the cap
 *  allows. Resolves with whatever rendered; a failed batch just stays plain. */
async function renderFences(
	fences: readonly Fence[],
): Promise<[string, RenderedBlock][]> {
	const batches: Fence[][] = [];
	for (let i = 0; i < fences.length; i += MAX_CODE_BLOCKS) {
		batches.push(fences.slice(i, i + MAX_CODE_BLOCKS));
	}
	const results = await Promise.all(
		batches.map(async (batch) => {
			try {
				const res = await fetch("/api/code", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						blocks: batch.map((f) => ({
							code: f.code,
							title: "",
							lines: 0,
							lang: f.lang,
						})),
					}),
				});
				if (!res.ok) return [];
				const body = (await res.json()) as { blocks: RenderedBlock[] };
				return batch.flatMap((f, i): [string, RenderedBlock][] => {
					const block = body.blocks[i];
					return block ? [[fenceKeyOf(f), block]] : [];
				});
			} catch {
				return [];
			}
		}),
	);
	return results.flat();
}

/** The plain code, laid out like the rendered frame (same body, rows and
 *  prompt), so only the colors change when the highlighted version lands. */
function PlainFence({ fence }: { fence: Fence }) {
	const rows = copyText(fence).split("\n");
	const shell = fence.lang === "bash";
	return (
		<div className="cb tabbed">
			<div className={shell ? "cb-body hang" : "cb-body"}>
				{rows.map((row, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are static per fence
					<div className="row" key={i}>
						{shell && i === 0 ? <span className="prompt">$</span> : null}
						{row || " "}
					</div>
				))}
			</div>
		</div>
	);
}

export function UseSection({
	name,
	tables,
	selected = null,
	selectedAt = 0,
}: {
	name: string;
	tables: Record<string, SubgraphTableInfo>;
	/** A table picked elsewhere on the page; its chip is pressed. */
	selected?: string | null;
	/** Bumps on every pick, so picking the same table again still applies. */
	selectedAt?: number;
}) {
	// The same order as the Tables panel: biggest first.
	const ordered = useMemo(
		() =>
			Object.entries(tables)
				.sort(([, a], [, b]) => b.rowCount - a.rowCount)
				.map(([table]) => table),
		[tables],
	);
	const [chosen, setTable] = useState<string | null>(selected);
	const [recipe, setRecipe] = useState<Recipe>("newest");
	const [lang, setLang] = useState<Lang>("sdk");
	const [samples, setSamples] = useState<ReadonlyMap<string, Sample>>(
		() => new Map(),
	);
	const [rendered, setRendered] = useState<ReadonlyMap<string, RenderedBlock>>(
		() => new Map(),
	);
	const [copied, setCopied] = useState(false);
	const asked = useRef(new Set<string>());
	const requested = useRef(new Set<string>());

	// A table opened in the Tables section becomes this section's table.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selectedAt re-applies a repeat pick of the same table
	useEffect(() => {
		if (selected) setTable(selected);
	}, [selected, selectedAt]);

	const table =
		chosen !== null && ordered.includes(chosen) ? chosen : (ordered[0] ?? "");
	const info = tables[table];

	// Everything one table needs: its newest row, then every recipe in every
	// language rendered in one go, so switching recipe or language is instant.
	// Called for the shown table and on intent (hover, focus, touch) for the
	// others, like the webhook payload prefetch. Each piece is asked for once.
	const samplesRef = useRef(new Map<string, Sample>());
	const warm = useCallback(
		async (target: string) => {
			const columns = tables[target]?.columns;
			if (!columns) return;
			if (!asked.current.has(target)) {
				asked.current.add(target);
				const sample = await readSample(name, target);
				samplesRef.current.set(target, sample);
				setSamples((prev) => new Map(prev).set(target, sample));
			}
			if (!samplesRef.current.has(target)) return; // another call is reading it
			const sample = samplesRef.current.get(target) ?? null;
			const fences = RECIPES.flatMap(({ id }) =>
				LANGS.map(({ id: l }) =>
					exampleFence({
						subgraph: name,
						table: target,
						columns,
						sample,
						recipe: id,
						lang: l,
					}),
				),
			).filter((f): f is Fence => f !== null);
			const todo = fences.filter((f) => !requested.current.has(fenceKeyOf(f)));
			if (todo.length === 0) return;
			for (const f of todo) requested.current.add(fenceKeyOf(f));
			const done = await renderFences(todo);
			const got = new Set(done.map(([key]) => key));
			for (const f of todo) {
				if (!got.has(fenceKeyOf(f))) requested.current.delete(fenceKeyOf(f));
			}
			if (done.length > 0) {
				setRendered((prev) => {
					const next = new Map(prev);
					for (const [key, block] of done) next.set(key, block);
					return next;
				});
			}
		},
		[name, tables],
	);

	useEffect(() => {
		if (table) void warm(table);
	}, [table, warm]);

	const fence = useMemo(
		() =>
			info
				? exampleFence({
						subgraph: name,
						table,
						columns: info.columns,
						sample: samples.get(table) ?? null,
						recipe,
						lang,
					})
				: null,
		[name, table, info, samples, recipe, lang],
	);

	const fenceKey = fence ? fenceKeyOf(fence) : null;
	const block = fenceKey ? rendered.get(fenceKey) : undefined;

	// The SDK example's tips need the page's tip listeners.
	useEffect(() => {
		if (block?.html.includes('class="tip"'))
			import("@/components/code/tips").then((m) => m.activate());
	}, [block]);

	if (ordered.length === 0) return null;

	return (
		<section className="use" aria-label="Use in your app">
			<div className="lf-h">
				<span className="dash-label">Use in your app</span>
				<span className="lf-count">@secondlayer/sdk</span>
			</div>
			<div className="use-top">
				<div className="picker use-chips">
					{ordered.map((candidate) => (
						<button
							key={candidate}
							type="button"
							aria-pressed={candidate === table}
							onPointerEnter={() => void warm(candidate)}
							onFocus={() => void warm(candidate)}
							onTouchStart={() => void warm(candidate)}
							onClick={() => setTable(candidate)}
						>
							{candidate}
						</button>
					))}
				</div>
				<div className="use-recipes">
					{RECIPES.map(({ id, label }) => (
						<button
							key={id}
							type="button"
							aria-pressed={id === recipe}
							onClick={() => setRecipe(id)}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div className="cb use-frame">
				<div className="cb-bar">
					<div className="tabbar mono" role="tablist">
						{LANGS.map(({ id, label }) => (
							<button
								key={id}
								type="button"
								role="tab"
								aria-selected={id === lang}
								onClick={() => setLang(id)}
							>
								{label}
							</button>
						))}
					</div>
					<span className="lang">{lang === "sdk" ? "TS" : "SH"}</span>
					<button
						type="button"
						className="use-copy"
						disabled={!fence}
						onClick={async () => {
							if (!fence) return;
							try {
								await navigator.clipboard.writeText(copyText(fence));
								setCopied(true);
								setTimeout(() => setCopied(false), COPIED_MS);
							} catch {
								// Clipboard blocked: leave the label as is.
							}
						}}
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
				<div className="use-body">
					{!fence ? (
						<p className="use-empty">
							The CLI doesn't stream rows. Use the SDK's subscribe or cURL.
						</p>
					) : block ? (
						<div
							className={block.className}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: built by `renderCode` on the server, which escapes every dynamic value
							dangerouslySetInnerHTML={{ __html: block.html }}
						/>
					) : (
						<PlainFence fence={fence} />
					)}
				</div>
			</div>
		</section>
	);
}
