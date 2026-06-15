"use client";

import { CopyButton } from "@/components/copy-button";
import { useCallback, useState } from "react";
import type { ExploreDetail } from "../types";

const fmt = new Intl.NumberFormat("en-US");

interface QueryState {
	phase: "idle" | "loading" | "done" | "error";
	body?: string;
	status?: number;
	ms?: number;
}

/**
 * Scalar-style reference: left column is one endpoint section per table,
 * right rail is a sticky live request/response cell. "try" on any table
 * loads it into the rail; Send fires a real anon fetch against /v1.
 */
export function DetailBody({
	detail,
	apiUrl,
	featured,
}: {
	detail: ExploreDetail;
	apiUrl: string;
	featured?: boolean;
}) {
	const tableNames = Object.keys(detail.tables);
	const [active, setActive] = useState(tableNames[0] ?? "");
	const [query, setQuery] = useState<QueryState>({ phase: "idle" });

	const path = `/v1/subgraphs/${detail.name}/${active}`;
	const queryString = "?_limit=3&_order=desc";
	const fullUrl = `${apiUrl}${path}${queryString}`;

	const send = useCallback(async () => {
		setQuery({ phase: "loading" });
		const started = performance.now();
		try {
			const res = await fetch(fullUrl);
			const ms = Math.round(performance.now() - started);
			const json = await res.json();
			setQuery({
				phase: res.ok ? "done" : "error",
				body: JSON.stringify(json, null, 2),
				status: res.status,
				ms,
			});
		} catch (e) {
			setQuery({
				phase: "error",
				body: e instanceof Error ? e.message : "request failed",
				ms: Math.round(performance.now() - started),
			});
		}
	}, [fullUrl]);

	const tryTable = useCallback((table: string) => {
		setActive(table);
		setQuery({ phase: "idle" });
	}, []);

	const scaffoldSource = detail.sources[0];
	const scaffoldCmd = scaffoldSource
		? `sl subgraphs scaffold ${scaffoldSource} -o my-${detail.name}.ts`
		: `sl subgraphs create my-${detail.name}`;

	const idleSample = `{
  "rows": [ { "_id": …, "_block_height": …, … } ],
  "next_cursor": "…",
  "tip": { "block_height": ${detail.tip.block_height}, "subgraph_height": ${detail.tip.subgraph_height}, "blocks_behind": ${detail.tip.blocks_behind} }
}`;

	return (
		<div className="explore-ref">
			<div>
				<section className="explore-head">
					<div className="explore-head-line">
						<h1>{detail.name}</h1>
						<span className="explore-vtag">v{detail.version}</span>
						<span className="explore-badge">public</span>
					</div>
					<p className="explore-desc-p">
						{detail.description ?? "Custom indexed view of Stacks."}{" "}
						<span className="explore-by">
							{featured && "by secondlayer"}
							{detail.sources.length > 0 && (
								<>
									{" "}
									· indexing <code>{shorten(detail.sources[0])}</code>
								</>
							)}{" "}
							since block {fmt.format(detail.start_block)}
						</span>
					</p>
					<div className="explore-head-meta">
						<span className="explore-hm">
							<span className="v">{tableNames.length}</span>
							<span className="k">tables</span>
						</span>
						<span className="explore-hm">
							<span className="v">
								<span
									className={`explore-dot${detail.tip.blocks_behind > 2 ? " lag" : ""}`}
								/>
								{detail.tip.blocks_behind > 2
									? `${fmt.format(detail.tip.blocks_behind)} behind`
									: "synced"}
							</span>
							<span className="k">freshness</span>
						</span>
						<span className="explore-hm">
							<span className="v">{fmt.format(detail.tip.block_height)}</span>
							<span className="k">chain tip</span>
						</span>
					</div>
				</section>

				{Object.entries(detail.tables).map(([table, def]) => (
					<section className="explore-endpoint" key={table}>
						<h2>{table}</h2>
						<div className="explore-ep">
							<span className="explore-ep-method">GET</span>
							<span className="explore-ep-path">
								<span className="dim">/v1/subgraphs/{detail.name}</span>/{table}
							</span>
							<button
								type="button"
								className="explore-ep-try"
								onClick={() => tryTable(table)}
								aria-label={`Load ${table} into the live query panel`}
								data-umami-event="explore-try"
							>
								try
							</button>
							<CopyButton code={`curl ${apiUrl}${def.endpoint}`} />
						</div>
						<div className="explore-attrs">
							{def.columns.map((col) => (
								<div className="explore-attr" key={col}>
									<span className="an">{col}</span>
									<span className="at">
										{def.column_types?.[col] ?? "text"}
									</span>
								</div>
							))}
							<div className="explore-attr">
								<span className="an">_block_height · _tx_id</span>
								<span className="at">system</span>
							</div>
						</div>
						<p className="explore-params">
							params: <code>_limit</code> · <code>_order=asc|desc</code> ·{" "}
							<code>cursor=&lt;next_cursor&gt;</code> · <code>_fields</code> ·{" "}
							<code>col.op=value</code> · also <code>/count</code>{" "}
							<code>/aggregate</code> <code>/stream</code>
						</p>
					</section>
				))}
			</div>

			<aside className="explore-rail" aria-label="Live query">
				<div className="explore-rail-inner">
					<span className="explore-rail-note" aria-hidden="true">
						try it — it&apos;s live
					</span>
					<div>
						<div className="explore-req">
							<div className="explore-req-line">
								<span className="m">GET</span>
								<span className="url">
									/{active}
									<span className="q">{queryString}</span>
								</span>
								<button
									type="button"
									className="explore-send"
									onClick={send}
									disabled={query.phase === "loading"}
								>
									Send
								</button>
							</div>
						</div>
						<div
							className={`explore-res${query.phase === "idle" ? " idle" : ""}`}
						>
							<div className="explore-res-meta">
								<span
									className="explore-dot"
									style={{
										opacity: query.phase === "idle" ? 0.35 : 1,
										background:
											query.phase === "error"
												? "var(--red, #ef4444)"
												: undefined,
									}}
								/>
								<span>
									{query.phase === "idle" && "idle · response shape"}
									{query.phase === "loading" && "querying…"}
									{query.phase === "done" &&
										`${query.status} · ${query.ms}ms · live`}
									{query.phase === "error" &&
										`${query.status ?? "error"} · ${query.ms}ms`}
								</span>
								<span className="spacer" />
								<CopyButton code={`curl '${fullUrl}'`} />
							</div>
							<pre>{query.body ?? idleSample}</pre>
							{query.phase === "idle" && (
								<p className="hint" aria-hidden="true">
									press Send — no key, no login
								</p>
							)}
						</div>
					</div>
					<div className="explore-fork">
						<span className="lbl">Build one like this</span>
						<div className="explore-ep">
							<span
								className="explore-ep-method"
								style={{
									color: "var(--text-main)",
									background: "var(--bg)",
									borderColor: "var(--border)",
								}}
							>
								CLI
							</span>
							<span className="explore-ep-path">{scaffoldCmd}</span>
							<CopyButton code={scaffoldCmd} umamiEvent="fork-explore" />
						</div>
						<p className="fine">
							Scaffolds a subgraph over the same contract — deploy under your
							own name and it lands on Explore.{" "}
							<em>View source · fork it with `sl subgraphs create`.</em>
						</p>
					</div>
					<div className="explore-agents">
						<span className="t">for agents</span>
						<div className="links">
							<a href={`${apiUrl}${detail.docs.markdown}`}>docs.md</a>
							<a href={`${apiUrl}${detail.docs.openapi}`}>openapi.json</a>
							<a href={`${apiUrl}${detail.docs.schema}`}>schema.json</a>
							<a
								href={`${apiUrl}/v1/subgraphs/${detail.name}/${tableNames[0] ?? ""}/stream`}
							>
								stream (SSE)
							</a>
						</div>
					</div>
				</div>
			</aside>
		</div>
	);
}

function shorten(contractId: string): string {
	const [principal, name] = contractId.split(".");
	if (!principal || !name) return contractId;
	return `${principal.slice(0, 8)}…${name}`;
}
