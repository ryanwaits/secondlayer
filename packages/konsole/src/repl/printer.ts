import util from "node:util";
import { cyan, dim } from "./colors.ts";

function toPlain(obj: unknown): Record<string, unknown> {
	if (
		obj &&
		typeof obj === "object" &&
		"attributes" in obj &&
		typeof (obj as any).attributes === "object"
	) {
		return (obj as any).attributes;
	}
	return obj as Record<string, unknown>;
}

export function printTable(rows: Record<string, unknown>[]) {
	if (rows.length === 0) {
		console.log(dim("  (empty)"));
		return;
	}

	const keys = Object.keys(rows[0]);
	const fmt = (v: unknown): string => {
		if (v === null) return "NULL";
		if (typeof v === "object") return JSON.stringify(v);
		return String(v);
	};

	const widths = keys.map((k) =>
		Math.max(k.length, ...rows.map((r) => Math.min(fmt(r[k]).length, 40))),
	);

	const header = keys
		.map((k, i) => cyan(k.padEnd(widths[i])))
		.join(dim("  |  "));
	const sep = widths.map((w) => "-".repeat(w)).join(dim("--+--"));
	console.log(`  ${header}`);
	console.log(dim(`  ${sep}`));

	for (const row of rows) {
		const line = keys
			.map((k, i) => {
				const v = row[k];
				if (v === null) return dim("NULL".padEnd(widths[i]));
				let s = fmt(v);
				if (s.length > 40) s = s.slice(0, 37) + "...";
				return s.padEnd(widths[i]);
			})
			.join(dim("  |  "));
		console.log(`  ${line}`);
	}

	console.log(dim(`\n  ${rows.length} row${rows.length === 1 ? "" : "s"}`));
}

export function printRecord(obj: Record<string, unknown>) {
	const maxKey = Math.max(...Object.keys(obj).map((k) => k.length));
	for (const [k, v] of Object.entries(obj)) {
		const val =
			v === null
				? dim("NULL")
				: typeof v === "object"
					? JSON.stringify(v)
					: String(v);
		console.log(`  ${cyan(k.padEnd(maxKey))}  ${val}`);
	}
}

export function printResult(output: unknown) {
	if (output === undefined || output === null) {
		console.log(dim(`  ${output}`));
		return;
	}
	if (Array.isArray(output)) {
		if (output.length === 0) {
			console.log(dim("  (empty)"));
			return;
		}
		if (typeof output[0] === "object" && output[0] !== null) {
			printTable(output.map(toPlain));
		} else {
			console.log(`  ${util.inspect(output, { colors: true, depth: 6 })}`);
		}
	} else if (typeof output === "object" && output !== null) {
		printRecord(toPlain(output));
	} else {
		console.log(`  ${util.inspect(output, { colors: true, depth: 6 })}`);
	}
}
