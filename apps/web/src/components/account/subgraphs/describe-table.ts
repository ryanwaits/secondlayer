import {
	type CodeBlockInput,
	MAX_CODE_BLOCKS,
	blockTitle,
} from "@/lib/code/blocks";
import type {
	SubgraphSourceInfo,
	SubgraphTableInfo,
} from "@/lib/subgraphs-store";

export type Piece = { text: string; code?: boolean };
export type Segment = { pieces: Piece[]; focus?: string };

export interface TableDescription {
	type: string;
	line: Piece[];
	prose: Segment[];
	code: string | null;
	start: number;
}

const MAX_EXCERPT_CHARS = 7500;

const HANDLER_KEY =
	/^\s*([A-Za-z_$][\w$]*)\s*:\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;

const text = (value: string): Piece => ({ text: value });
const code = (value: string): Piece => ({ text: value, code: true });

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const indentOf = (line: string): string => /^\s*/.exec(line)?.[0] ?? "";

interface Handler {
	key: string;
	keyIndex: number;
	excerpt: string | null;
	columnCount: number;
}

function findHandler(table: string, sourceCode: string | null): Handler | null {
	if (!sourceCode) return null;
	const lines = sourceCode.split("\n");
	const write = new RegExp(
		`\\.(insert|upsert|update|delete|increment)\\(\\s*(['"\`])${escapeRegExp(table)}\\2`,
	);
	const writeIndex = lines.findIndex((line) => write.test(line));
	if (writeIndex < 0) return null;

	let keyIndex = -1;
	let key = "";
	for (let i = writeIndex; i >= 0; i--) {
		const match = HANDLER_KEY.exec(lines[i] as string);
		if (match) {
			keyIndex = i;
			key = match[1] as string;
			break;
		}
	}
	if (keyIndex < 0) return null;

	let depth = 0;
	let endIndex = -1;
	for (let i = keyIndex; i < lines.length; i++) {
		const line = lines[i] as string;
		depth += line.split("{").length - line.split("}").length;
		if (depth <= 0) {
			endIndex = i;
			break;
		}
	}
	if (endIndex < writeIndex)
		return { key, keyIndex, excerpt: null, columnCount: 0 };

	let columnEnd = writeIndex + 1;
	while (
		columnEnd < endIndex &&
		!(lines[columnEnd] as string).trim().startsWith("}")
	)
		columnEnd++;
	const columnCount = columnEnd - (writeIndex + 1);

	const out: string[] = [];
	for (let i = keyIndex; i <= endIndex; i++) {
		const line = lines[i] as string;
		if (i === keyIndex) out.push(`${indentOf(line)}// !ref(1:1) event`);
		if (i === writeIndex + 1 && columnCount > 0)
			out.push(`${indentOf(line)}// !ref(1:${columnCount}) columns`);
		out.push(line);
	}
	const excerpt = out.join("\n");
	return {
		key,
		keyIndex,
		excerpt: excerpt.length > MAX_EXCERPT_CHARS ? null : excerpt,
		columnCount,
	};
}

const contractName = (contractId: string | undefined): string | null => {
	if (!contractId) return null;
	const name = contractId.slice(contractId.lastIndexOf(".") + 1);
	return name || null;
};

const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

export function describeTable(input: {
	table: string;
	rowCount: number;
	columns: string[];
	sources: Record<string, SubgraphSourceInfo>;
	sourceCode: string | null;
}): TableDescription {
	const { table, rowCount, columns, sources, sourceCode } = input;
	const handler = findHandler(table, sourceCode);
	const source = handler ? sources[handler.key] : undefined;
	// The count is the database's estimate, so the copy never states it exactly.
	const rows = rowCount.toLocaleString("en-US");
	const excerpt = handler?.excerpt ?? null;
	const columnTotal =
		handler && handler.columnCount > 0 ? handler.columnCount : columns.length;
	const columnLink = excerpt !== null && (handler?.columnCount ?? 0) > 0;
	const printTopic =
		source?.type === "print_event" && source.topic ? source.topic : null;

	let line: Piece[];
	let lead: Piece[];
	let event: Piece[];
	let between: string;
	let columnsPhrase: string;
	if (!handler) {
		const noHandlerProse: Segment[] = [
			{
				pieces: [
					text(`${plural(columnTotal, "column")}. About ${rows} rows so far.`),
				],
			},
		];
		return {
			type: "handler",
			line: [text(`≈${rows} rows`)],
			prose: noHandlerProse,
			code: null,
			start: 1,
		};
	}
	if (printTopic) {
		const contract = contractName(source?.contractId);
		line = [
			text("Rows from "),
			code(printTopic),
			text(` prints · ≈${rows} rows`),
		];
		lead = [text("Writes one row for every ")];
		event = [code(printTopic), text(" print")];
		between = `${contract ? ` from ${contract}` : ""}, with `;
		columnsPhrase = `${plural(columnTotal, "column")} copied from the event`;
	} else {
		line = [
			text("Rows from the "),
			code(handler.key),
			text(` handler · ≈${rows} rows`),
		];
		lead = [text("Writes rows from the ")];
		event = [code(handler.key), text(" handler")];
		between = ", with ";
		columnsPhrase = plural(columnTotal, "column");
	}

	const prose: Segment[] = [
		{ pieces: lead },
		excerpt !== null ? { pieces: event, focus: "event" } : { pieces: event },
		{ pieces: [text(between)] },
		columnLink
			? { pieces: [text(columnsPhrase)], focus: "columns" }
			: { pieces: [text(columnsPhrase)] },
		{ pieces: [text(`. About ${rows} rows so far.`)] },
	];
	return {
		type: source?.type ?? "handler",
		line,
		prose,
		code: excerpt,
		start: handler ? handler.keyIndex + 1 : 1,
	};
}

export function tableCode(input: {
	name: string;
	tables: Record<string, SubgraphTableInfo>;
	sources: Record<string, SubgraphSourceInfo> | undefined;
	sourceCode: string | null;
}): {
	descriptions: { table: string; description: TableDescription }[];
	blocks: CodeBlockInput[];
} {
	const { name, tables, sources, sourceCode } = input;
	const descriptions = Object.entries(tables)
		.sort(([, a], [, b]) => b.rowCount - a.rowCount)
		.map(([table, info]) => ({
			table,
			description: describeTable({
				table,
				rowCount: info.rowCount,
				columns: Object.keys(info.columns).filter(
					(column) => !column.startsWith("_"),
				),
				sources: sources ?? {},
				sourceCode,
			}),
		}));
	const blocks = descriptions
		.filter((d) => d.description.code !== null)
		.slice(0, MAX_CODE_BLOCKS)
		.map((d) => ({
			code: d.description.code as string,
			title: blockTitle(name),
			lines: d.description.start,
		}));
	return { descriptions, blocks };
}
