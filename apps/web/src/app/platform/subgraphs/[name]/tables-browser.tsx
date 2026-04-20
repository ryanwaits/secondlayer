"use client";

import { DetailSection } from "@/components/console/detail-section";
import { useState } from "react";
import { SubgraphDataBrowser } from "./data-browser";

interface ColumnInfo {
	type: string;
	nullable?: boolean;
	indexed?: boolean;
	searchable?: boolean;
}

interface TableInfo {
	rowCount: number;
	endpoint: string;
	columns: Record<string, ColumnInfo>;
	indexes?: string[][];
	uniqueKeys?: string[][];
	example: unknown;
}

interface Props {
	subgraphName: string;
	tables: Record<string, TableInfo>;
	sessionToken: string;
}

function SchemaView({ columns }: { columns: Record<string, ColumnInfo> }) {
	return (
		<>
			<div className="sg-schema-col-header">
				<span>Column</span>
				<span>Type</span>
				<span>Attributes</span>
			</div>
			{Object.entries(columns).map(([colName, col]) => (
				<div key={colName} className="sg-schema-col-row">
					<span
						className={`sg-col-name${colName.startsWith("_") ? " system" : ""}`}
					>
						{colName}
					</span>
					<span className="sg-col-type">{col.type}</span>
					<span className="sg-col-attrs">
						{colName.startsWith("_") && (
							<span className="sg-col-badge system">system</span>
						)}
						{col.indexed && (
							<span className="sg-col-badge indexed">indexed</span>
						)}
						{col.searchable && (
							<span className="sg-col-badge searchable">searchable</span>
						)}
					</span>
				</div>
			))}
		</>
	);
}

export function SubgraphTablesBrowser({
	subgraphName,
	tables,
	sessionToken,
}: Props) {
	const tableNames = Object.keys(tables);
	const [activeTable, setActiveTable] = useState(tableNames[0] ?? "");
	const [view, setView] = useState<"schema" | "data">("schema");

	if (!tableNames.length) return null;

	const currentTable = tables[activeTable];
	const colCount = currentTable ? Object.keys(currentTable.columns).length : 0;

	const metaText =
		view === "schema"
			? `${colCount} columns`
			: `${currentTable?.rowCount.toLocaleString() ?? 0} rows`;

	return (
		<DetailSection title="Tables">
			<div className="sg-tables-card">
				{/* Table tabs */}
				<div className="sg-tables-tab-bar">
					{tableNames.map((name) => (
						<button
							key={name}
							type="button"
							className={`sg-tables-tab${name === activeTable ? " active" : ""}`}
							onClick={() => setActiveTable(name)}
						>
							{name}
							<span className="row-count">
								{tables[name].rowCount.toLocaleString()}
							</span>
						</button>
					))}
				</div>

				{/* View switcher toolbar */}
				<div className="sg-tables-toolbar">
					<div className="sg-view-switcher">
						<button
							type="button"
							className={`sg-view-btn${view === "schema" ? " active" : ""}`}
							onClick={() => setView("schema")}
						>
							Schema
						</button>
						<button
							type="button"
							className={`sg-view-btn${view === "data" ? " active" : ""}`}
							onClick={() => setView("data")}
						>
							Data
						</button>
					</div>
					<span className="sg-tables-meta">{metaText}</span>
				</div>

				{/* Schema view */}
				{view === "schema" && currentTable && (
					<SchemaView columns={currentTable.columns} />
				)}

				{/* Data view */}
				{view === "data" && (
					<SubgraphDataBrowser
						subgraphName={subgraphName}
						tables={tableNames}
						sessionToken={sessionToken}
						controlledTable={activeTable}
						hideTableTabs
					/>
				)}
			</div>
		</DetailSection>
	);
}
