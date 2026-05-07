"use client";

import { useCallback, useMemo, useState } from "react";
import { CopyButton } from "./copy-button";

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
	/** Optional title shown above the panel. */
	title?: string;
};

const DEFAULT_API_BASE = "https://api.secondlayer.tools";

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
}: DatasetSandboxProps) {
	const [values, setValues] = useState<Record<string, string>>(() => {
		const initial: Record<string, string> = {};
		for (const f of filters) {
			if (f.default !== undefined) initial[f.name] = f.default;
		}
		return initial;
	});
	const [response, setResponse] = useState<ResponseState>({ kind: "idle" });

	const queryString = useMemo(() => buildQuery(values), [values]);
	const fullUrl = `${apiBase}${endpoint}${queryString}`;
	const curlSnippet = `curl "${fullUrl}"`;
	const fetchSnippet = `const res = await fetch(\n  "${fullUrl}",\n);\nconst data = await res.json();`;

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
				const res = await fetch(fullUrl, {
					headers: { accept: "application/json" },
				});
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
		[fullUrl],
	);

	const responseBody = formatResponseBody(response);

	return (
		<div className="dataset-sandbox">
			{title ? <div className="dataset-sandbox-title">{title}</div> : null}

			<form className="dataset-sandbox-form" onSubmit={handleSubmit}>
				<div className="dataset-sandbox-endpoint">
					<span className="dataset-sandbox-method">GET</span>
					<code className="dataset-sandbox-path">
						{endpoint}
						{queryString || ""}
					</code>
				</div>

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

				<div className="dataset-sandbox-actions">
					<button
						type="submit"
						className="dataset-sandbox-submit"
						disabled={response.kind === "loading"}
					>
						{response.kind === "loading" ? "Loading…" : "Send"}
					</button>
					{response.kind !== "idle" && response.kind !== "loading" ? (
						<span className="dataset-sandbox-status">
							{response.kind === "ok"
								? "200 OK"
								: `${response.status ?? "—"} ${response.kind === "error" ? "error" : ""}`}{" "}
							· {response.latencyMs}ms
						</span>
					) : null}
				</div>
			</form>

			<div className="dataset-sandbox-snippets">
				<details className="dataset-sandbox-snippet" open>
					<summary>curl</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{curlSnippet}</code>
						</pre>
						<CopyButton code={curlSnippet} />
					</div>
				</details>
				<details className="dataset-sandbox-snippet">
					<summary>fetch (TypeScript)</summary>
					<div className="dataset-sandbox-snippet-body">
						<pre className="code-block">
							<code>{fetchSnippet}</code>
						</pre>
						<CopyButton code={fetchSnippet} />
					</div>
				</details>
			</div>

			<div className="dataset-sandbox-response">
				<div className="dataset-sandbox-response-header">Response</div>
				<pre className="code-block dataset-sandbox-response-body">
					<code>{responseBody}</code>
				</pre>
			</div>
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
		<label className="dataset-sandbox-filter" htmlFor={id}>
			<span className="dataset-sandbox-filter-label">
				{filter.name}
				{filter.helper ? (
					<span className="dataset-sandbox-filter-helper">
						{" "}
						{filter.helper}
					</span>
				) : null}
			</span>
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
				/>
			)}
		</label>
	);
}

function buildQuery(values: Record<string, string>): string {
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(values)) {
		if (v.length > 0) params.set(k, v);
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

function formatResponseBody(state: ResponseState): string {
	if (state.kind === "idle") {
		return "// Hit Send to see live JSON.";
	}
	if (state.kind === "loading") {
		return "// fetching…";
	}
	if (state.kind === "error") {
		return `// ${state.message}`;
	}
	try {
		return JSON.stringify(state.body, null, 2);
	} catch {
		return String(state.body);
	}
}
