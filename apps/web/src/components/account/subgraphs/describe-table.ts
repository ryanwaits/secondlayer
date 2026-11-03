import type { SubgraphSourceInfo } from "@/lib/subgraphs-store";

/**
 * What a subgraph table is, in words, read from the deployed source: the
 * closed row's sentence, the open row's prose (phrases are focus links) and
 * the table's handler excerpt with `// !ref` comments the code frame turns
 * into focus targets. Pure; reads user text, so it never throws: when the
 * handler can't be found, `code` is null and the page shows prose only.
 */

export type Piece = { text: string; code?: boolean };
export type Segment = { pieces: Piece[]; focus?: string };

export interface TableDescription {
	/** The source type, e.g. "print_event". */
	type: string;
	/** The closed row's sentence. */
	line: Piece[];
	/** The open row's prose; segments with `focus` become click-to-press links. */
	prose: Segment[];
	/** The handler excerpt with `// !ref(1:n) <name>` lines inserted; null when it can't be found. */
	code: string | null;
	/** 1-based line number of the excerpt's first source line. */
	start: number;
}

/** The code frame renders at most this many characters per block. */
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
	/** 0-based index of the handler's key line. */
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
	const handlerKey = handler?.key ?? table;
	const source = handler ? sources[handler.key] : undefined;
	const rows = rowCount.toLocaleString("en-US");
	const excerpt = handler?.excerpt ?? null;
	const columnTotal =
		handler && handler.columnCount > 0 ? handler.columnCount : columns.length;
	const columnLink = excerpt !== null && (handler?.columnCount ?? 0) > 0;
	const printTopic =
		source?.type === "print_event" && source.topic ? source.topic : null;

	// How the closed line and the prose name the event the rows come from.
	let line: Piece[];
	let lead: Piece[];
	let event: Piece[];
	let between: string;
	let columnsPhrase: string;
	if (printTopic) {
		const contract = contractName(source?.contractId);
		line = [
			text("Rows from "),
			code(printTopic),
			text(` prints · ${rows} rows`),
		];
		lead = [text("Writes one row for every ")];
		event = [code(printTopic), text(" print")];
		between = `${contract ? ` from ${contract}` : ""}, with `;
		columnsPhrase = `${plural(columnTotal, "column")} copied from the event`;
	} else {
		line = [
			text("Rows from the "),
			code(handlerKey),
			text(` handler · ${rows} rows`),
		];
		lead = [text("Writes rows from the ")];
		event = [code(handlerKey), text(" handler")];
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
		{ pieces: [text(`. ${rows} rows so far.`)] },
	];
	return {
		type: source?.type ?? "handler",
		line,
		prose,
		code: excerpt,
		start: handler ? handler.keyIndex + 1 : 1,
	};
}
