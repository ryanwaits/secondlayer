"use client";

import "@/components/code/code.css";
import type { RenderedBlock } from "@/lib/code/blocks";
import type { SubgraphTableInfo } from "@/lib/subgraphs-store";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
	const sampleKnown = samples.has(table);

	// One read per table, the first time it is shown.
	useEffect(() => {
		if (!table || asked.current.has(table)) return;
		asked.current.add(table);
		readSample(name, table).then((sample) =>
			setSamples((prev) => new Map(prev).set(table, sample)),
		);
	}, [name, table]);

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

	const fenceKey = fence ? `${fence.lang}\n${fence.code}` : null;
	const block = fenceKey ? rendered.get(fenceKey) : undefined;

	// Render once the table's newest row is known, so the frame doesn't draw
	// twice. Responses are cached by fence text, so a late one is never wrong.
	useEffect(() => {
		if (!fence || !fenceKey || !sampleKnown) return;
		if (requested.current.has(fenceKey)) return;
		requested.current.add(fenceKey);
		fetch("/api/code", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				blocks: [{ code: fence.code, title: "", lines: 0, lang: fence.lang }],
			}),
		})
			.then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
			.then((body: { blocks: RenderedBlock[] }) => {
				const next = body.blocks[0];
				if (next) setRendered((prev) => new Map(prev).set(fenceKey, next));
			})
			.catch(() => {
				// The plain code below stays: the section never depends on this.
				requested.current.delete(fenceKey);
			});
	}, [fence, fenceKey, sampleKnown]);

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
						<pre className="lf-pre">{copyText(fence)}</pre>
					)}
				</div>
			</div>
		</section>
	);
}
