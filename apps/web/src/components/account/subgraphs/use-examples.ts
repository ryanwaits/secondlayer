import { stripAnnotations } from "@/lib/code/annotations";
import { blockTitle } from "@/lib/code/blocks";

/**
 * "Use in your app": the code a reader pastes to read one table, as the SDK,
 * the CLI or cURL. Pure text builders. The recipes and the filter rule live
 * only here; the section renders whatever comes back.
 */

export type Recipe = "newest" | "filter" | "count" | "live";
export type Lang = "sdk" | "cli" | "curl";
export type Columns = Record<string, { type: string }>;
export type Fence = { code: string; lang: "ts" | "bash" };

export const RECIPES: readonly { id: Recipe; label: string }[] = [
	{ id: "newest", label: "Newest" },
	{ id: "filter", label: "Filter" },
	{ id: "count", label: "Count" },
	{ id: "live", label: "Live" },
];

const PAGE_LIMIT = 20;

/** "perf-test-sbtc" -> "perfTestSbtc"; a leading digit gets a "subgraph" prefix. */
export function clientName(subgraph: string): string {
	const parts = subgraph.split(/[^A-Za-z0-9]+/).filter(Boolean);
	const joined = parts
		.map((part, i) =>
			i === 0
				? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
				: `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
		)
		.join("");
	if (joined === "") return "subgraph";
	return /^\d/.test(joined) ? `subgraph${joined}` : joined;
}

const isNumeric = (type: string): boolean => type === "uint" || type === "int";

const isDigits = (value: unknown): value is string | number =>
	(typeof value === "string" || typeof value === "number") &&
	/^-?\d+$/.test(String(value));

/** Digits grouped with `_` from 7 digits up, as a TypeScript literal reads. */
function groupUnderscore(digits: string): string {
	const match = /^(-?)(\d+)$/.exec(digits);
	if (!match) return digits;
	const body = match[2] ?? "";
	return `${match[1]}${
		body.length >= 7 ? body.replace(/\B(?=(\d{3})+(?!\d))/g, "_") : body
	}`;
}

/** A shell word: bare when plain, single-quoted otherwise. */
function shellWord(text: string): string {
	return /^[\w.:/@,=-]+$/.test(text)
		? text
		: `'${text.replace(/'/g, "'\\''")}'`;
}

/** A `curl -d` argument: double-quoted when plain, single-quoted otherwise. */
function dataArg(text: string): string {
	return /^[\w.:/@,=-]+$/.test(text) ? `"${text}"` : shellWord(text);
}

/** What the filter recipe matches on, and its value in each language. */
type Filter = {
	/** CLI/REST key: `sender`, `amount.gte`. */
	key: string;
	/** Raw value for the CLI and REST. */
	raw: string;
	/** The SDK `where` clause body. */
	sdk: string;
};

function filterFor(
	columns: Columns,
	sample: Record<string, unknown> | null,
): Filter {
	const entries = Object.entries(columns);
	const principal = entries.find(([, c]) => c.type === "principal");
	const numeric = entries.find(([, c]) => isNumeric(c.type));
	const text = entries.find(([, c]) => c.type === "text");
	const chosen = principal ?? numeric ?? text;

	if (!chosen) {
		const height = sample?._block_height;
		const digits = isDigits(height) ? String(height) : "0";
		return {
			key: "_block_height.gte",
			raw: digits,
			sdk: `_blockHeight: { gte: ${groupUnderscore(digits)}n }`,
		};
	}

	const [column, { type }] = chosen;
	const value = sample?.[column];
	if (isNumeric(type)) {
		const digits = isDigits(value) ? String(value) : "0";
		return {
			key: `${column}.gte`,
			raw: digits,
			sdk: `${column}: { gte: ${groupUnderscore(digits)}n }`,
		};
	}
	const placeholder = type === "principal" ? "SP…" : "";
	const string =
		typeof value === "string" && value !== "" ? value : placeholder;
	return {
		key: column,
		raw: string,
		sdk: `${column}: ${JSON.stringify(string)}`,
	};
}

const TIPS = {
	getSubgraph:
		"Returns a typed client for your subgraph. Reads SECONDLAYER_API_KEY from your environment.",
	findMany:
		"Reads one page of rows. Pass nextCursor back to read the next page.",
	aggregate: "Counts and sums rows over the same filters as findMany.",
	subscribe:
		"Tails rows as the subgraph writes them. Returns a function that stops it.",
} as const;

function sdkCode(args: {
	subgraph: string;
	table: string;
	columns: Columns;
	sample: Record<string, unknown> | null;
	recipe: Recipe;
}): string {
	const { subgraph, table, columns, sample, recipe } = args;
	const client = clientName(subgraph);
	const call = `${client}.${table}`;
	const method = (name: keyof typeof TIPS, line: string) => [
		"",
		`// !tip[/${name}/] ${TIPS[name]}`,
		line,
	];
	const head = [
		`import { getSubgraph } from "@secondlayer/sdk";`,
		`import definition from "./${blockTitle(subgraph).replace(/\.ts$/, "")}";`,
		"",
		`// !tip[/getSubgraph/] ${TIPS.getSubgraph}`,
		`const ${client} = getSubgraph(definition);`,
	];
	let body: string[];
	if (recipe === "newest") {
		body = [
			...method(
				"findMany",
				`const { rows, nextCursor } = await ${call}.findMany({`,
			),
			`  orderBy: { _blockHeight: "desc" },`,
			`  limit: ${PAGE_LIMIT},`,
			"});",
		];
	} else if (recipe === "filter") {
		body = [
			...method("findMany", `const { rows } = await ${call}.findMany({`),
			`  where: { ${filterFor(columns, sample).sdk} },`,
			`  orderBy: { _blockHeight: "desc" },`,
			"});",
		];
	} else if (recipe === "count") {
		const sum = Object.entries(columns).find(([, c]) => isNumeric(c.type));
		body = sum
			? [
					...method(
						"aggregate",
						`const { count, sum } = await ${call}.aggregate({`,
					),
					"  count: true,",
					`  sum: [${JSON.stringify(sum[0])}],`,
					"});",
				]
			: [
					...method("aggregate", `const { count } = await ${call}.aggregate({`),
					"  count: true,",
					"});",
				];
	} else {
		const first = Object.keys(columns)[0] ?? "_id";
		const height = sample?._block_height;
		const listener = `(row) => console.log(row.${first})`;
		body = isDigits(height)
			? [
					...method("subscribe", `const stop = ${call}.subscribe(`),
					`  ${listener},`,
					`  { since: ${groupUnderscore(String(height))} },`,
					");",
				]
			: method("subscribe", `const stop = ${call}.subscribe(${listener});`);
	}
	return [...head, ...body].join("\n");
}

function cliCode(args: {
	subgraph: string;
	table: string;
	columns: Columns;
	sample: Record<string, unknown> | null;
	recipe: Recipe;
}): string | null {
	const { subgraph, table, columns, sample, recipe } = args;
	const base = `sl subgraphs query ${subgraph} ${table}`;
	const newest = "--sort _block_height --order desc";
	if (recipe === "newest") return `${base} ${newest} --limit ${PAGE_LIMIT}`;
	if (recipe === "filter") {
		const { key, raw } = filterFor(columns, sample);
		return `${base} --filter ${shellWord(`${key}=${raw}`)} ${newest}`;
	}
	if (recipe === "count") return `${base} --count`;
	return null;
}

function curlCode(args: {
	subgraph: string;
	table: string;
	columns: Columns;
	sample: Record<string, unknown> | null;
	recipe: Recipe;
}): string {
	const { subgraph, table, columns, sample, recipe } = args;
	const url = (suffix = "") =>
		`"$SECONDLAYER_API_URL/v1/subgraphs/${subgraph}/${table}${suffix}"`;
	const auth = `  -H "Authorization: Bearer $SECONDLAYER_API_KEY"`;
	const get = (params: string[]) =>
		params.length === 0
			? []
			: [`  -G ${params.map((p) => `-d ${dataArg(p)}`).join(" ")}`];
	const order = ["_sort=_block_height", "_order=desc"];
	let lines: string[];
	if (recipe === "newest") {
		lines = [`curl ${url()}`, auth, ...get([...order, `_limit=${PAGE_LIMIT}`])];
	} else if (recipe === "filter") {
		const { key, raw } = filterFor(columns, sample);
		lines = [`curl ${url()}`, auth, ...get([`${key}=${raw}`, ...order])];
	} else if (recipe === "count") {
		const sum = Object.entries(columns).find(([, c]) => isNumeric(c.type));
		lines = [
			`curl ${url("/aggregate")}`,
			auth,
			...get(["_count=true", ...(sum ? [`_sum=${sum[0]}`] : [])]),
		];
	} else {
		const height = sample?._block_height;
		lines = [
			`curl -N ${url("/stream")}`,
			auth,
			...get(isDigits(height) ? [`since=${height}`] : []),
		];
	}
	return lines
		.map((line, i) => (i < lines.length - 1 ? `${line} \\` : line))
		.join("\n");
}

export function exampleFence(args: {
	subgraph: string;
	table: string;
	columns: Columns;
	sample: Record<string, unknown> | null;
	recipe: Recipe;
	lang: Lang;
}): Fence | null {
	if (args.lang === "sdk") return { code: sdkCode(args), lang: "ts" };
	if (args.lang === "cli") {
		const code = cliCode(args);
		return code === null ? null : { code, lang: "bash" };
	}
	return { code: curlCode(args), lang: "bash" };
}

/** What Copy puts on the clipboard: the fence without its annotation lines. */
export function copyText(fence: Fence): string {
	return stripAnnotations(fence.code, fence.lang);
}
