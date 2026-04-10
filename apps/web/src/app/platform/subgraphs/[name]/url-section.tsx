"use client";

import { DetailSection } from "@/components/console/detail-section";
import { TabbedCode } from "@/components/console/tabbed-code";
import type { ReactNode } from "react";
import { useRef, useState } from "react";

interface TableInfo {
	endpoint: string;
	example: unknown;
	columns: Record<
		string,
		{
			type: string;
			nullable?: boolean;
			indexed?: boolean;
			searchable?: boolean;
		}
	>;
}

interface Props {
	tables: Record<string, TableInfo>;
	apiKeyPrefix?: string;
}

interface QueryParam {
	name: string;
	type: string;
	default: string | null;
	desc: ReactNode;
}

function buildQueryParams(table: TableInfo | undefined): QueryParam[] {
	const cols = table?.columns ?? {};
	const colNames = Object.keys(cols).filter((c) => !c.startsWith("_"));
	const indexedCols = Object.entries(cols)
		.filter(([, c]) => c.indexed)
		.map(([name]) => name);
	const searchableCols = Object.entries(cols)
		.filter(([, c]) => c.searchable)
		.map(([name]) => name);

	const params: QueryParam[] = [
		{
			name: "_limit",
			type: "integer",
			default: "100",
			desc: (
				<>
					Maximum number of rows to return. Max <code>1000</code>.
				</>
			),
		},
		{
			name: "_offset",
			type: "integer",
			default: "0",
			desc: "Number of rows to skip for pagination.",
		},
		{
			name: "_sort",
			type: "string",
			default: null,
			desc:
				indexedCols.length > 0 ? (
					<>
						Column to sort by. Indexed:{" "}
						{indexedCols.map((c, i) => (
							<span key={c}>
								{i > 0 && ", "}
								<code>{c}</code>
							</span>
						))}
					</>
				) : (
					"Column to sort results by."
				),
		},
		{
			name: "_order",
			type: '"asc" | "desc"',
			default: '"asc"',
			desc: (
				<>
					Sort direction. Applied to the column specified by <code>_sort</code>.
				</>
			),
		},
		{
			name: "{column}.{op}",
			type: "varies",
			default: null,
			desc: (
				<>
					Filter by column value. Operators: <code>eq</code>, <code>gt</code>,{" "}
					<code>lt</code>, <code>gte</code>, <code>lte</code>, <code>like</code>
					.
					<br />
					Columns:{" "}
					{colNames.slice(0, 6).map((c, i) => (
						<span key={c}>
							{i > 0 && ", "}
							<code>{c}</code>
						</span>
					))}
					{colNames.length > 6 && <> + {colNames.length - 6} more</>}
				</>
			),
		},
		{
			name: "_fields",
			type: "string",
			default: null,
			desc: "Comma-separated list of columns to return. Omit for all columns.",
		},
	];

	if (searchableCols.length > 0) {
		params.push({
			name: "_search",
			type: "string",
			default: null,
			desc: (
				<>
					Full-text search across:{" "}
					{searchableCols.map((c, i) => (
						<span key={c}>
							{i > 0 && ", "}
							<code>{c}</code>
						</span>
					))}
				</>
			),
		});
	}

	return params;
}

export function SubgraphUrlSection({ tables, apiKeyPrefix }: Props) {
	const tableNames = Object.keys(tables);
	const [selectedTable, setSelectedTable] = useState(tableNames[0] ?? "");
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const [responseOpen, setResponseOpen] = useState(false);
	const dropRef = useRef<HTMLDivElement>(null);

	if (!tableNames.length) return null;

	const title = tableNames.length === 1 ? "Endpoint" : "Endpoints";

	const API_BASE = "https://api.secondlayer.tools/api";
	const relativePath = tables[selectedTable]?.endpoint ?? "";
	const fullUrl = `${API_BASE}${relativePath}`;

	const handleCopy = async () => {
		await navigator.clipboard.writeText(fullUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const selectTable = (name: string) => {
		setSelectedTable(name);
		setOpen(false);
		setCopied(false);
		setResponseOpen(false);
	};

	const keyDisplay = apiKeyPrefix ? `${apiKeyPrefix}****` : "YOUR_API_KEY";
	const keyCopy = "YOUR_API_KEY";

	// Split relative path at last "/" for accent coloring on the table segment
	const lastSlash = relativePath.lastIndexOf("/");
	const pathBase = relativePath.slice(0, lastSlash + 1);
	const pathTable = relativePath.slice(lastSlash + 1);

	const dropdown = (
		<div className="meta-dropdown-wrap" ref={dropRef}>
			<button
				type="button"
				className="overview-meta-btn"
				onClick={() => setOpen(!open)}
				onBlur={(e) => {
					if (!dropRef.current?.contains(e.relatedTarget as Node))
						setOpen(false);
				}}
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<rect x="2" y="3" width="12" height="10" rx="1" />
					<path d="M2 7h12" />
					<path d="M6 3v10" />
				</svg>
				<span
					style={{
						width: "1px",
						height: "10px",
						background: "var(--border)",
						display: "inline-block",
						flexShrink: 0,
					}}
				/>
				{selectedTable}
				<svg
					width="8"
					height="8"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M4 6l4 4 4-4" />
				</svg>
			</button>
			{open && (
				<div className="meta-dropdown">
					{tableNames.map((name) => (
						<button
							key={name}
							type="button"
							className={`meta-dropdown-item${name === selectedTable ? " active" : ""}`}
							onMouseDown={(e) => {
								e.preventDefault();
								selectTable(name);
							}}
						>
							{name}
							{name === selectedTable && (
								<svg
									width="12"
									height="12"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<path d="M3 8.5l3.5 3.5 6.5-8" />
								</svg>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);

	return (
		<DetailSection title={title} actions={dropdown}>
			<div className="sg-api-columns">
				{/* Left: URL bar + query parameters */}
				<div className="sg-api-card">
					<div className="sg-api-url-bar">
						<span className="sg-api-method">GET</span>
						<span className="sg-api-url">
							{pathBase}
							<span className="table-segment">{pathTable}</span>
						</span>
						<button
							type="button"
							className={`sg-api-copy-btn${copied ? " copied" : ""}`}
							onClick={handleCopy}
							title="Copy endpoint URL"
						>
							{copied ? (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : (
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
								</svg>
							)}
						</button>
					</div>
					<div className="sg-params-section">
						<div className="sg-params-heading">Query parameters</div>
						{buildQueryParams(tables[selectedTable]).map((p) => (
							<div key={p.name} className="sg-param-row">
								<div className="sg-param-name-line">
									<span className="sg-param-name">{p.name}</span>
									<span className="sg-param-type">{p.type}</span>
									{p.default && (
										<span className="sg-param-default">
											default: <em>{p.default}</em>
										</span>
									)}
								</div>
								<div className="sg-param-desc">{p.desc}</div>
							</div>
						))}
					</div>
				</div>

				{/* Right: Code examples + response accordion */}
				<div className="sg-api-right-stack">
					<TabbedCode
						key={selectedTable}
						tabs={[
							{
								label: "cURL",
								lang: "bash",
								code: `curl '${relativePath}' \\\n  -H 'Authorization: Bearer ${keyDisplay}' \\\n  -G \\\n  -d '_limit=10&_offset=0'`,
								copyCode: `curl '${fullUrl}' \\\n  -H 'Authorization: Bearer ${keyCopy}' \\\n  -G \\\n  -d '_limit=10&_offset=0'`,
							},
							{
								label: "Node.js",
								lang: "javascript",
								code: `const response = await fetch(\n  '${relativePath}?_limit=10',\n  { headers: { Authorization: \`Bearer ${keyDisplay}\` } }\n);\nconst data = await response.json();`,
								copyCode: `const response = await fetch(\n  '${fullUrl}?_limit=10',\n  { headers: { Authorization: \`Bearer ${keyCopy}\` } }\n);\nconst data = await response.json();`,
							},
						]}
					/>
					{tables[selectedTable]?.example != null && (
						<div className={`sg-accordion${responseOpen ? " open" : ""}`}>
							<button
								type="button"
								className="sg-accordion-trigger"
								onClick={() => setResponseOpen(!responseOpen)}
							>
								<div className="sg-accordion-trigger-left">
									<span className="sg-accordion-label">Response</span>
									<span className="sg-accordion-badge ok">200</span>
								</div>
								<svg
									className="sg-accordion-chevron"
									width="12"
									height="12"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									aria-hidden="true"
								>
									<path d="M4 6l4 4 4-4" />
								</svg>
							</button>
							<div className="sg-accordion-body">
								<div className="sg-accordion-content">
									<pre className="sg-accordion-code">
										{JSON.stringify(tables[selectedTable].example, null, 2)}
									</pre>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</DetailSection>
	);
}
