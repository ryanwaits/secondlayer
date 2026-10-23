"use client";

import { Choice } from "@/components/choice";
import { Skel } from "@/components/dashboard/shell/skel";
import { formatDate } from "@/lib/account-data";
import { DEFAULT_SORT, groupDigits, queryCommand } from "@/lib/subgraph-view";
import { type SubgraphDetailData, newestRow } from "@/lib/subgraphs-store";
import { useEffect, useState } from "react";
import { FloatingCard } from "../floating-card";
import { JsonView } from "../webhooks/payload-view";
import { CliLine } from "../webhooks/shared";
import { SchemaView } from "./schema-view";

const API_ORIGIN = "https://api.secondlayer.tools";

/** The newest row as the drawer knows it: still loading, or read (null when
 *  the table is empty). */
export type NewestRow =
	| { status: "loading" }
	| { status: "ok"; row: Record<string, unknown> | null };

/** The HTTP call that reads a table's rows, newest first. */
export function httpQuery(endpoint: string): string {
	const url = endpoint.startsWith("/") ? `${API_ORIGIN}${endpoint}` : endpoint;
	return `GET ${url}?_sort=${DEFAULT_SORT.column}&_order=${DEFAULT_SORT.order}&_limit=10`;
}

/** One table's schema, newest row, query commands and source. */
export function SchemaDrawerBody({
	detail,
	table,
	onTable,
	newest,
}: {
	detail: SubgraphDetailData;
	table: string;
	onTable: (table: string) => void;
	newest: NewestRow;
}) {
	const tableNames = Object.keys(detail.tables);
	const info = detail.tables[table];
	return (
		<>
			{tableNames.length > 1 ? (
				<Choice
					name="sg-drawer-table"
					size="sm"
					legend="Table"
					options={tableNames.map((name) => ({ value: name, label: name }))}
					value={table}
					onChange={onTable}
				/>
			) : null}
			{info ? (
				<>
					<section className="wd-def">
						<h3>
							{table} · {groupDigits(String(info.rowCount))}{" "}
							{info.rowCount === 1 ? "row" : "rows"}
						</h3>
						<SchemaView table={info} />
					</section>
					<section className="wd-def">
						<h3>Newest row</h3>
						{newest.status === "loading" ? (
							<Skel width="100%" height={96} style={{ display: "block" }} />
						) : newest.row ? (
							<div className="sg-newest">
								<JsonView value={newest.row} />
							</div>
						) : (
							<p className="wd-faint">No rows yet.</p>
						)}
					</section>
					<section className="wd-def">
						<h3>Query it</h3>
						<CliLine
							label="CLI"
							command={queryCommand({
								name: detail.name,
								table,
								sort: DEFAULT_SORT.column,
								order: DEFAULT_SORT.order,
								filters: [],
							})}
						/>
						<CliLine label="HTTP" command={httpQuery(info.endpoint)} />
					</section>
				</>
			) : (
				<p className="wd-faint">This subgraph has no tables yet.</p>
			)}
			<section className="wd-def">
				<h3>Source</h3>
				<dl className="wd-kv">
					<dt>Version</dt>
					<dd>v{detail.version}</dd>
					<dt>Created</dt>
					<dd>{formatDate(detail.createdAt)}</dd>
					<dt>Last processed</dt>
					<dd>Block {detail.lastProcessedBlock.toLocaleString("en-US")}</dd>
				</dl>
			</section>
		</>
	);
}

/** Reads a table's newest row each time the drawer opens or the table changes. */
function useNewestRow(name: string, table: string, open: boolean): NewestRow {
	const [state, setState] = useState<{ key: string; row: NewestRow }>({
		key: "",
		row: { status: "loading" },
	});
	const key = `${name}/${table}`;
	useEffect(() => {
		if (!open || !table) return;
		let live = true;
		setState({ key, row: { status: "loading" } });
		void newestRow(name, table).then((row) => {
			if (live) setState({ key, row: { status: "ok", row } });
		});
		return () => {
			live = false;
		};
	}, [open, name, table, key]);
	return state.key === key ? state.row : { status: "loading" };
}

/**
 * A subgraph's schema, out of the page's way: columns and types, the newest
 * row, and how to query it. The page reports; the CLI edits.
 */
export function SchemaDrawer({
	detail,
	table,
	onTable,
	open,
	onClose,
}: {
	detail: SubgraphDetailData;
	table: string;
	onTable: (table: string) => void;
	open: boolean;
	onClose: () => void;
}) {
	const newest = useNewestRow(detail.name, table, open);
	return (
		<FloatingCard
			open={open}
			onClose={onClose}
			scrim
			title={detail.name}
			subtitle="Subgraph · schema"
		>
			<SchemaDrawerBody
				detail={detail}
				table={table}
				onTable={onTable}
				newest={newest}
			/>
		</FloatingCard>
	);
}
