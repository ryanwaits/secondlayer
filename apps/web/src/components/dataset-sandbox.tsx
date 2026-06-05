"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CollapsibleJsonTree } from "./collapsible-json-tree";
import { CopyButton } from "./copy-button";
import { InlineKeyCreate } from "./inline-key-create";
import { SandboxCode } from "./sandbox-code";

export type SandboxFilterDef =
	| {
			name: string;
			type: "string" | "number";
			placeholder?: string;
			helper?: string;
			default?: string;
	  }
	| {
			name: string;
			type: "enum";
			options: readonly string[];
			helper?: string;
			default?: string;
	  };

export type DatasetSandboxProps = {
	/** Endpoint path, e.g. "/v1/datasets/sbtc/events" — no leading host. */
	endpoint: string;
	/** Filter inputs to render. The user-edited values become URL query params. */
	filters: readonly SandboxFilterDef[];
	/** Optional default API base. Falls back to `https://api.secondlayer.tools`. */
	apiBase?: string;
	/** Optional label shown above the cell. */
	title?: string;
	/** When true, render an API key control + send `Authorization: Bearer <key>`. */
	requiresApiKey?: boolean;
	/**
	 * A representative response envelope, shown dimmed in the idle state so the
	 * shape is legible before the first request. Omit to show just the hint.
	 */
	sample?: unknown;
};

const DEFAULT_API_BASE = "https://api.secondlayer.tools";
// Persisted only in the visitor's browser — never sent to our servers.
const API_KEY_STORAGE = "sl-sandbox-api-key";
// Env-var reference shown in snippets so the real key never leaves the client.
const KEY_ENV_VAR = "SL_API_KEY";

type ResponseState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ok"; status: number; latencyMs: number; body: unknown }
	| {
			kind: "error";
			status: number | null;
			latencyMs: number;
			message: string;
	  };

export function DatasetSandbox({
	endpoint,
	filters,
	apiBase = DEFAULT_API_BASE,
	title,
	requiresApiKey = false,
	sample,
}: DatasetSandboxProps) {
	const [values, setValues] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const f of filters) {
			if (f.default !== undefined) initial[f.name] = f.default;
		}
		return initial;
	});
	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [creating, setCreating] = useState(false);
	const [response, setResponse] = useState<ResponseState>({ kind: "idle" });

	// Restore a previously-entered key from the browser (client-only).
	useEffect(() => {
		if (!requiresApiKey || typeof window === "undefined") return;
		try {
			const saved = window.localStorage.getItem(API_KEY_STORAGE);
			if (saved) setApiKey(saved);
		} catch {
			// localStorage may be unavailable (private mode) — ignore.
		}
	}, [requiresApiKey]);

	const updateApiKey = useCallback((value: string) => {
		setApiKey(value);
		if (typeof window === "undefined") return;
		try {
			if (value) window.localStorage.setItem(API_KEY_STORAGE, value);
			else window.localStorage.removeItem(API_KEY_STORAGE);
		} catch {
			// Ignore storage failures — the key still works for this session.
		}
	}, []);

	const queryString = useMemo(() => buildQuery(values), [values]);
	const fullUrl = `${apiBase}${endpoint}${queryString}`;
	// Snippets reference an env var, never the real key — so the key is never
	// embedded in text that gets sent to our highlight server action or copied.
	const authHeaderForSnippet = requiresApiKey
		? ` \\\n  -H "Authorization: Bearer $${KEY_ENV_VAR}"`
		: "";
	const curlSnippet = `curl "${fullUrl}"${authHeaderForSnippet}`;
	const fetchSnippet = requiresApiKey
		? `const res = await fetch(\n  "${fullUrl}",\n  { headers: { Authorization: \`Bearer \${process.env.${KEY_ENV_VAR}}\` } },\n);\nconst data = await res.json();`
		: `const res = await fetch(\n  "${fullUrl}",\n);\nconst data = await res.json();`;

	const handleChange = useCallback((name: string, value: string) => {
		setValues((prev) => {
			const next = { ...prev };
			if (value === "") {
				delete next[name];
			} else {
				next[name] = value;
			}
			return next;
		});
	}, []);

	const handleSubmit = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();
			setResponse({ kind: "loading" });
			const started = performance.now();
			try {
				const headers: Record<string, string> = {
					accept: "application/json",
				};
				if (requiresApiKey && apiKey) {
					headers.Authorization = `Bearer ${apiKey}`;
				}
				// Sent straight from the browser to the API host — never via our server.
				const res = await fetch(fullUrl, { headers });
				const latencyMs = Math.round(performance.now() - started);
				const text = await res.text();
				let body: unknown;
				try {
					body = JSON.parse(text);
				} catch {
					body = text;
				}
				if (!res.ok) {
					setResponse({
						kind: "error",
						status: res.status,
						latencyMs,
						message:
							typeof body === "object" && body !== null && "error" in body
								? String((body as { error: unknown }).error)
								: `HTTP ${res.status}`,
					});
					return;
				}
				setResponse({ kind: "ok", status: res.status, latencyMs, body });
			} catch (err) {
				const latencyMs = Math.round(performance.now() - started);
				setResponse({
					kind: "error",
					status: null,
					latencyMs,
					message: err instanceof Error ? err.message : String(err),
				});
			}
		},
		[fullUrl, apiKey, requiresApiKey],
	);

	const isObjectBody =
		response.kind === "ok" &&
		typeof response.body === "object" &&
		response.body !== null;
	const rows = response.kind === "ok" ? rowCount(response.body) : null;
	const prettyBody = response.kind === "ok" ? safeStringify(response.body) : "";
	// 401/403 on a write-gated endpoint → route the user into the key flow.
	const authError =
		requiresApiKey &&
		response.kind === "error" &&
		(response.status === 401 || response.status === 403);

	return (
		<div className="dataset-sandbox">
			{title ? <div className="dataset-sandbox-title">{title}</div> : null}

			{/* ── Request strip: the cell input ── */}
			<form className="dataset-sandbox-form" onSubmit={handleSubmit}>
				<div className="dataset-sandbox-req">
					<div className="dataset-sandbox-line">
						<span className="dataset-sandbox-method">GET</span>
						<code className="dataset-sandbox-path">
							{endpoint}
							{queryString ? (
								<span className="dataset-sandbox-query">{queryString}</span>
							) : null}
						</code>
						<button
							type="submit"
							className="dataset-sandbox-submit"
							disabled={response.kind === "loading"}
						>
							{response.kind === "loading" ? (
								<span className="dataset-sandbox-spin" aria-hidden="true" />
							) : (
								<PlayIcon />
							)}
							{response.kind === "loading" ? "Running" : "Send"}
						</button>
					</div>

					{requiresApiKey ? (
						<div className="dataset-sandbox-keyline">
							{creating ? (
								<InlineKeyCreate
									onKey={(k) => {
										updateApiKey(k);
										setShowKey(false);
										setCreating(false);
									}}
									onCancel={() => setCreating(false)}
								/>
							) : (
								<>
									<span className="dataset-sandbox-keyline-label">
										<KeyIcon />
										API key · stored in your browser only
									</span>
									<div className="dataset-sandbox-key-row">
										<input
											type={showKey ? "text" : "password"}
											autoComplete="off"
											autoCorrect="off"
											autoCapitalize="off"
											spellCheck={false}
											data-1p-ignore=""
											data-lpignore="true"
											data-form-type="other"
											value={apiKey}
											onChange={(e) => updateApiKey(e.target.value)}
											placeholder="sk-sl_..."
											aria-label="API key"
											className="dataset-sandbox-filter-input"
										/>
										<button
											type="button"
											className="dataset-sandbox-key-btn"
											onClick={() => setShowKey((s) => !s)}
											aria-label={showKey ? "Hide API key" : "Show API key"}
										>
											{showKey ? "Hide" : "Show"}
										</button>
										{apiKey ? (
											<button
												type="button"
												className="dataset-sandbox-key-btn"
												onClick={() => updateApiKey("")}
											>
												Forget
											</button>
										) : (
											<button
												type="button"
												className="dataset-sandbox-key-btn"
												onClick={() => setCreating(true)}
											>
												Create a key
											</button>
										)}
									</div>
								</>
							)}
						</div>
					) : null}

					{filters.length > 0 ? (
						<div className="dataset-sandbox-filters">
							{filters.map((filter) => (
								<FilterInput
									key={filter.name}
									filter={filter}
									value={values[filter.name] ?? ""}
									onChange={handleChange}
								/>
							))}
						</div>
					) : null}
				</div>
			</form>

			{/* ── Response: the cell output, the hero ── */}
			<div className="dataset-sandbox-res">
				<div className="dataset-sandbox-res-meta">
					<span className={`dataset-sandbox-dot ${metaDot(response)}`} />
					{response.kind === "idle" ? <span>not run yet</span> : null}
					{response.kind === "loading" ? <span>running…</span> : null}
					{response.kind === "ok" ? (
						<>
							<span className="dataset-sandbox-status">{response.status}</span>
							<span className="dataset-sandbox-sep">·</span>
							<span>{response.latencyMs} ms</span>
							{rows !== null ? (
								<>
									<span className="dataset-sandbox-sep">·</span>
									<span>
										{rows} row{rows === 1 ? "" : "s"}
									</span>
								</>
							) : null}
						</>
					) : null}
					{response.kind === "error" ? (
						<>
							<span className="dataset-sandbox-status err">
								{response.status ?? "—"}
							</span>
							<span className="dataset-sandbox-sep">·</span>
							<span>{response.latencyMs} ms</span>
						</>
					) : null}
				</div>

				<div
					className={`dataset-sandbox-res-body${response.kind === "idle" ? " is-idle" : ""}`}
				>
					{response.kind === "idle" ? (
						<>
							{sample !== undefined ? (
								<CollapsibleJsonTree data={sample} expandDepth={3} />
							) : null}
							<div className="dataset-sandbox-hint">
								<span>Press</span>
								<kbd>Send</kbd>
								<span>to run this against live data.</span>
							</div>
						</>
					) : null}

					{response.kind === "loading" ? <Skeleton rows={5} /> : null}

					{response.kind === "ok" && isObjectBody ? (
						<>
							<CopyButton code={prettyBody} />
							<CollapsibleJsonTree
								data={(response as { body: unknown }).body}
							/>
							{rows === 0 ? (
								<div className="dataset-sandbox-nudge">
									No rows matched. Loosen a filter and run again.
								</div>
							) : null}
						</>
					) : null}

					{response.kind === "ok" && !isObjectBody ? (
						<pre className="code-block">
							<code>{prettyBody}</code>
						</pre>
					) : null}

					{response.kind === "error" ? (
						<>
							<div className="dataset-sandbox-error">{`// ${response.message}`}</div>
							{authError && !creating ? (
								<button
									type="button"
									className="dataset-sandbox-error-action"
									onClick={() => setCreating(true)}
								>
									<KeyIcon />
									Create a key
								</button>
							) : null}
						</>
					) : null}
				</div>
			</div>

			{/* ── Snippets: demoted to one quiet disclosure ── */}
			<details className="dataset-sandbox-snippets">
				<summary>Code · curl, fetch</summary>
				<div className="dataset-sandbox-snippet-body">
					<SandboxCode code={curlSnippet} lang="bash" />
				</div>
				<div className="dataset-sandbox-snippet-body">
					<SandboxCode code={fetchSnippet} lang="typescript" />
				</div>
			</details>
		</div>
	);
}

function FilterInput({
	filter,
	value,
	onChange,
}: {
	filter: SandboxFilterDef;
	value: string;
	onChange: (name: string, value: string) => void;
}) {
	const id = `sandbox-filter-${filter.name}`;
	return (
		<label
			className={`dataset-sandbox-filter${value ? " is-set" : ""}`}
			htmlFor={id}
			title={filter.helper}
		>
			<span className="dataset-sandbox-filter-label">{filter.name}</span>
			{filter.type === "enum" ? (
				<select
					id={id}
					value={value}
					onChange={(e) => onChange(filter.name, e.target.value)}
				>
					<option value="">(any)</option>
					{filter.options.map((opt) => (
						<option key={opt} value={opt}>
							{opt}
						</option>
					))}
				</select>
			) : (
				<input
					id={id}
					type={filter.type === "number" ? "number" : "text"}
					placeholder={filter.placeholder}
					value={value}
					onChange={(e) => onChange(filter.name, e.target.value)}
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
					spellCheck={false}
					data-1p-ignore=""
					data-lpignore="true"
					data-form-type="other"
				/>
			)}
		</label>
	);
}

function Skeleton({ rows }: { rows: number }) {
	// Varied widths read as "rows of data" rather than a progress bar.
	const widths = ["38%", "72%", "64%", "80%", "46%"];
	return (
		<div className="dataset-sandbox-skeleton" aria-hidden="true">
			{Array.from({ length: rows }, (_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder bars
					key={i}
					className="dataset-sandbox-sk"
					style={{ width: widths[i % widths.length] }}
				/>
			))}
		</div>
	);
}

function PlayIcon() {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M8 5v14l11-7z" />
		</svg>
	);
}

function KeyIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
		</svg>
	);
}

function metaDot(state: ResponseState): string {
	if (state.kind === "ok") return "ok";
	if (state.kind === "error") return "err";
	if (state.kind === "idle") return "idle";
	return "";
}

function buildQuery(values: Record<string, string>): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(values)) {
		if (v.length > 0) params.set(k, v);
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

// Row count for the meta line — the first array we find in the envelope, or the
// body itself when it's a bare array. Null when there's nothing countable.
function rowCount(body: unknown): number | null {
	if (Array.isArray(body)) return body.length;
	if (body && typeof body === "object") {
		for (const key of [
			"events",
			"transactions",
			"calls",
			"results",
			"data",
			"rows",
			"items",
		]) {
			const v = (body as Record<string, unknown>)[key];
			if (Array.isArray(v)) return v.length;
		}
	}
	return null;
}

function safeStringify(body: unknown): string {
	try {
		return JSON.stringify(body, null, 2);
	} catch {
		return String(body);
	}
}
