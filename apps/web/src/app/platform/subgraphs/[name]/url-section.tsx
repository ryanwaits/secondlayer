"use client";

import { TabbedCode } from "@/components/console/tabbed-code";
import { useRef, useState } from "react";

interface Props {
	tables: Record<string, { endpoint: string }>;
	apiKeyPrefix?: string;
}

export function SubgraphUrlSection({ tables, apiKeyPrefix }: Props) {
	const tableNames = Object.keys(tables);
	const [selectedTable, setSelectedTable] = useState(tableNames[0] ?? "");
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	const dropRef = useRef<HTMLDivElement>(null);

	if (!tableNames.length) return null;

	const title = tableNames.length === 1 ? "Endpoint" : "Endpoints";

	const API_BASE = "https://api.secondlayer.tools";
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
	};

	const keyDisplay = apiKeyPrefix ? `${apiKeyPrefix}****` : "YOUR_API_KEY";
	const keyCopy = "YOUR_API_KEY";

	// Split at last "/" for accent coloring on the table segment
	const lastSlash = fullUrl.lastIndexOf("/");
	const urlBase = fullUrl.slice(0, lastSlash + 1);
	const urlTable = fullUrl.slice(lastSlash + 1);

	return (
		<div className="sg-detail-section">
			<div className="sg-detail-header">
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<span className="sg-detail-title">{title}</span>
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
				</div>
			</div>

			<div className="sg-url-snippet">
				<span className="sg-url-text">
					{urlBase}
					{urlTable && <span className="url-table">{urlTable}</span>}
				</span>
				<button
					type="button"
					className={`sg-url-copy-btn${copied ? " copied" : ""}`}
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

			<div style={{ marginTop: "16px" }}>
				<TabbedCode
					key={selectedTable}
					tabs={[
						{
							label: "cURL",
							lang: "bash",
							code: `curl '${fullUrl}' \\\n  -H 'Authorization: Bearer ${keyDisplay}' \\\n  -G \\\n  -d '_limit=10&_offset=0'`,
							copyCode: `curl '${fullUrl}' \\\n  -H 'Authorization: Bearer ${keyCopy}' \\\n  -G \\\n  -d '_limit=10&_offset=0'`,
						},
						{
							label: "Node.js",
							lang: "javascript",
							code: `const response = await fetch(\n  '${fullUrl}?_limit=10',\n  { headers: { Authorization: \`Bearer ${keyDisplay}\` } }\n);\nconst data = await response.json();`,
							copyCode: `const response = await fetch(\n  '${fullUrl}?_limit=10',\n  { headers: { Authorization: \`Bearer ${keyCopy}\` } }\n);\nconst data = await response.json();`,
						},
					]}
				/>
			</div>
		</div>
	);
}
