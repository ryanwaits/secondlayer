/** Pure view helpers for the Subgraphs screens: grid columns, cell
 *  formatting, sort state, and the CLI and SDK strings for the current view. */

export type SortOrder = "asc" | "desc";
export type TableFilter = { column: string; value: string };
export type SortState = { column: string; order: SortOrder };

export const PAGE_SIZE = 25;
export const DEFAULT_SORT: SortState = {
	column: "_block_height",
	order: "desc",
};

const HIDDEN_COLUMNS = new Set(["_id", "_created_at"]);
const NUMERIC_TYPES = new Set(["uint", "int", "bigint", "serial"]);

export const isNumericType = (type: string): boolean => NUMERIC_TYPES.has(type);

export interface GridColumn {
	name: string;
	type: string;
	numeric: boolean;
}

/** `_block_height`, then the table's own columns in definition order, then
 *  `_tx_id`. `_id` and `_created_at` stay out of the grid. */
export function gridColumns(
	columns: Record<string, { type: string }>,
): GridColumn[] {
	const make = (name: string): GridColumn => ({
		name,
		type: columns[name]?.type ?? "text",
		numeric: isNumericType(columns[name]?.type ?? ""),
	});
	const own = Object.keys(columns).filter(
		(name) => !name.startsWith("_") && !HIDDEN_COLUMNS.has(name),
	);
	return [
		...("_block_height" in columns ? ["_block_height"] : []),
		...own,
		...("_tx_id" in columns ? ["_tx_id"] : []),
	].map(make);
}

/** Group a digit string without ever going through `Number`: values can
 *  exceed 2^53. */
export function groupDigits(digits: string): string {
	const match = /^(-?)(\d+)$/.exec(digits);
	if (!match) return digits;
	return `${match[1]}${(match[2] ?? "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function middle(value: string, head: number, tail: number): string {
	return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export interface Cell {
	text: string;
	/** The full value, when `text` is shortened. */
	title?: string;
	tone: "ink" | "sub" | "faint";
}

const JSON_PREVIEW = 60;
const TEXT_PREVIEW = 48;

export function formatCell(type: string, name: string, value: unknown): Cell {
	if (value === null || value === undefined) {
		return { text: "null", tone: "faint" };
	}
	if (name === "_tx_id") {
		const full = String(value);
		const hex = full.replace(/^0x/, "");
		return {
			text: hex.length > 8 ? `0x${middle(hex, 4, 4)}` : full,
			title: full,
			tone: "sub",
		};
	}
	if (isNumericType(type)) {
		const digits =
			typeof value === "number" && !Number.isSafeInteger(value)
				? BigInt(Math.trunc(value)).toString()
				: String(value);
		return { text: groupDigits(digits), tone: "ink" };
	}
	if (type === "principal") {
		const full = String(value);
		return full.length > 14
			? { text: middle(full, 5, 4), title: full, tone: "ink" }
			: { text: full, tone: "ink" };
	}
	if (type === "jsonb") {
		const full = typeof value === "string" ? value : JSON.stringify(value);
		return full.length > JSON_PREVIEW
			? { text: `${full.slice(0, JSON_PREVIEW)}…`, title: full, tone: "ink" }
			: { text: full, tone: "ink" };
	}
	if (type === "timestamp") {
		const ms = new Date(String(value)).getTime();
		return {
			text: Number.isFinite(ms)
				? `${new Date(ms).toISOString().slice(0, 19)}Z`
				: String(value),
			tone: "ink",
		};
	}
	const full = String(value);
	return full.length > TEXT_PREVIEW
		? { text: middle(full, 24, 18), title: full, tone: "ink" }
		: { text: full, tone: "ink" };
}

/** A value the row panel offers a Filter link for: a non-null scalar that is
 *  not a system id, a write time or a jsonb document. */
export function canFilter(type: string, name: string, value: unknown): boolean {
	if (name === "_id" || name === "_created_at") return false;
	if (type === "jsonb" || value === null || value === undefined) return false;
	return typeof value !== "object";
}

/** Desc first, then asc, then back to desc. A new column starts at desc. */
export function toggleSort(current: SortState, column: string): SortState {
	if (current.column !== column) return { column, order: "desc" };
	return { column, order: current.order === "desc" ? "asc" : "desc" };
}

export const isDefaultSort = (sort: SortState): boolean =>
	sort.column === DEFAULT_SORT.column && sort.order === DEFAULT_SORT.order;

/** Add a filter, replacing one already on that column. */
export function withFilter(
	filters: readonly TableFilter[],
	next: TableFilter,
): TableFilter[] {
	return [...filters.filter((f) => f.column !== next.column), next];
}

const SHELL_SAFE = /^[\w.:@+/=-]+$/;
const shellQuote = (value: string) =>
	SHELL_SAFE.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

interface ViewState {
	name: string;
	table: string;
	sort: string;
	order: SortOrder;
	filters: readonly TableFilter[];
}

/** The CLI call that shows the same rows. `--order` is always passed: the CLI
 *  default is asc. */
export function queryCommand({
	name,
	table,
	sort,
	order,
	filters,
}: ViewState): string {
	const flags = filters
		.map((f) => ` --filter ${shellQuote(`${f.column}=${f.value}`)}`)
		.join("");
	return `sl subgraphs query ${name} ${table} --sort ${sort} --order ${order}${flags}`;
}

/** The SDK call that reads the same page. */
export function sdkSnippet({
	name,
	table,
	sort,
	order,
	filters,
}: ViewState): string {
	const lines = [
		`const { rows, next_cursor } = await sl.subgraphs.rows(${JSON.stringify(name)}, ${JSON.stringify(table)}, {`,
		`  sort: ${JSON.stringify(sort)}, order: ${JSON.stringify(order)}, limit: ${PAGE_SIZE},`,
	];
	if (filters.length > 0) {
		const pairs = filters
			.map((f) => `${JSON.stringify(f.column)}: ${JSON.stringify(f.value)}`)
			.join(", ");
		lines.push(`  filters: { ${pairs} },`);
	}
	lines.push("})");
	return lines.join("\n");
}

/** Filter pairs as query params, for the rows route and its stream. */
export function filterParams(filters: readonly TableFilter[]): URLSearchParams {
	const params = new URLSearchParams();
	for (const f of filters) params.set(f.column, f.value);
	return params;
}

/** The query string (no leading `?`) for one page of rows through the proxy. */
export function rowsQuery({
	sort,
	order,
	filters,
	cursor,
	limit = PAGE_SIZE,
}: {
	sort: string;
	order: SortOrder;
	filters: readonly TableFilter[];
	cursor?: string | null;
	limit?: number;
}): string {
	const params = new URLSearchParams({
		_sort: sort,
		_order: order,
		_limit: String(limit),
	});
	for (const [key, value] of filterParams(filters)) params.set(key, value);
	if (cursor) params.set("cursor", cursor);
	return params.toString();
}

/** Counts as live when the subgraph is under two blocks behind the tip. */
export const isLive = (blocksBehind: number): boolean => blocksBehind < 2;

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export const blocksLabel = (n: number): string => plural(n, "block");

/** "413k", "1.2M": compact counts for table tabs. */
export function shortCount(n: number): string {
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
	return `${+(n / 1_000_000).toFixed(1)}M`;
}

/** "1.2 GB", "340 MB": storage as a person reads it. */
export function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let i = 0;
	while (value >= 1000 && i < units.length - 1) {
		value /= 1000;
		i++;
	}
	return `${i === 0 ? value : +value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

/** Handler errors in the last 24 hours: the sum of the newest 24 hourly
 *  buckets from `/health`. The one definition both screens, the status dot
 *  and the sentence use; null until health has loaded. */
export function handlerErrors24h(
	health: { hours: readonly { errors: number }[] } | undefined,
): number | null {
	if (!health) return null;
	return health.hours.slice(-24).reduce((sum, h) => sum + h.errors, 0);
}

export type Tone = "ok" | "alarm" | "hi" | "idle";

/** Red for a failing subgraph or any handler error in 24 hours, a quiet dot
 *  while it is not active (reindexing, stopped), else the normal dot. */
export function subgraphTone(status: string, errors24h: number | null): Tone {
	if (status === "error" || (errors24h ?? 0) > 0) return "alarm";
	return status === "active" ? "ok" : "idle";
}

/** The list row's state line: lag, rows and, when known, errors in 24 hours. */
export function stateLine(
	blocksBehind: number,
	rows: number,
	errors24h: number | null,
	status = "active",
): string {
	const lag =
		status === "reindexing"
			? `Reindexing · ${blocksLabel(blocksBehind)} left`
			: isLive(blocksBehind)
				? "At the tip"
				: `Behind tip ${blocksLabel(blocksBehind)}`;
	return [
		lag,
		plural(rows, "row").replace(/^\d+/, groupDigits(String(rows))),
		errors24h === null ? null : `${plural(errors24h, "error")} 24h`,
	]
		.filter(Boolean)
		.join(" · ");
}

/** Rows written in one day-sized window, with the first hour it covers. */
export interface DailyBucket {
	start: string;
	rowsWritten: number;
}

/** Hourly health folded into 24-hour windows from the oldest hour, so 168
 *  hours make 7 days. A trailing partial window keeps its shorter sum. */
export function dailyBuckets(
	hours: readonly { hour: string; rowsWritten: number }[],
): DailyBucket[] {
	const days: DailyBucket[] = [];
	for (let i = 0; i < hours.length; i += 24) {
		const window = hours.slice(i, i + 24);
		days.push({
			start: window[0]?.hour ?? "",
			rowsWritten: window.reduce((sum, h) => sum + h.rowsWritten, 0),
		});
	}
	return days;
}
