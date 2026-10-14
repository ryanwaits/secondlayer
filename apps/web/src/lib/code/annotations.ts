import { normalizeLang } from "../highlight";

/** Annotation names the renderer understands. Anything else is an authoring error (see budget.test.ts). */
export const ANNOTATION_NAMES = [
	"mark",
	"callout",
	"focus",
	"diff",
	"collapse",
	"link",
	"error",
	"ref",
	"pick",
] as const;

/** A block that marks everything marks nothing: per-block limits that keep color meaningful (budget.test.ts, and the SDK reference's examples). */
export const ANNOTATION_LIMITS = { mark: 2, callout: 3, focus: 1 } as const;

export type FenceOptions = {
	lang: string;
	title?: string;
	/** First line number; `lines` alone starts at 1. */
	lines?: number;
	nocopy?: boolean;
	wrap?: boolean;
	/** Clamp height in lines. The renderer applies its own default when absent. */
	max?: number;
	exit?: number;
	/** HTTP status chip in the bar: green below 300, red from 400. */
	status?: number;
	/** Hosted base URLs in the source follow the page's Base URL switch. */
	base?: boolean;
};

/**
 * The opening fence's info string: `ts consumer.ts lines=14 wrap`. The title is
 * the first bare token containing `.`, `/` or `~`; everything else is a flag.
 */
export function parseFenceOptions(info: string): FenceOptions {
	const [first = "", ...rest] = info.trim().split(/\s+/);
	const options: FenceOptions = { lang: normalizeLang(first) };
	for (const token of rest) {
		const [key, value] = token.split("=");
		if (key === "lines") options.lines = value ? Number(value) : 1;
		else if (key === "nocopy") options.nocopy = true;
		else if (key === "wrap") options.wrap = true;
		else if (key === "max") options.max = Number(value);
		else if (key === "exit") options.exit = Number(value);
		else if (key === "status") options.status = Number(value);
		else if (key === "base") options.base = true;
		else if (!options.title && !value && /[./~]/.test(token))
			options.title = token;
	}
	return options;
}

export type Annotation = {
	name: string;
	/** Index into the output lines of the first targeted line. */
	from: number;
	/** Index of the last targeted line (inclusive). */
	to: number;
	/** Token selector; with the `g` flag every match on a line, otherwise the first. */
	regex: RegExp | null;
	value: string;
};

export type ParsedCode = {
	/** Source lines with annotation comments removed. */
	lines: string[];
	annotations: Annotation[];
};

const COMMENT_TOKEN: Record<string, string> = {
	typescript: "//",
	tsx: "//",
	javascript: "//",
	json: "//",
	bash: "#",
	toml: "#",
	text: "#",
	yaml: "#",
	ini: "#",
	sql: "--",
	clarity: ";;",
	solidity: "//",
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `(2:4)`, `(3)` or `[/re/g]` groups, in either order, then the free-text value. */
const GROUP = /^(?:\((\d+)(?::(\d+))?\)|\[\/(.+?)\/([a-z]*)\])/;

function lineMatcher(lang: string): RegExp | null {
	const token = COMMENT_TOKEN[lang];
	if (!token) return null;
	return new RegExp(`^\\s*${escapeRegex(token)}\\s*!(\\w+)(.*)$`);
}

/**
 * Code Hike's grammar: a whole comment line `<c> !name(range)[/regex/flags] value`
 * applies to the next output line, then leaves the output. `(a:b)` picks lines
 * relative to the comment, `(a)` one line, `[/re/]` the first match per line,
 * `[/re/g]` every match.
 */
export function parseAnnotations(source: string, lang: string): ParsedCode {
	const normalized = normalizeLang(lang);
	const matcher = lineMatcher(normalized);
	const lines: string[] = [];
	const annotations: Annotation[] = [];
	for (const line of source.split("\n")) {
		const match = matcher?.exec(line);
		if (!match) {
			lines.push(line);
			continue;
		}
		const at = lines.length;
		let rest = (match[2] ?? "").trimStart();
		let from = at;
		let to = at;
		let regex: RegExp | null = null;
		for (let group = GROUP.exec(rest); group; group = GROUP.exec(rest)) {
			rest = rest.slice(group[0].length).trimStart();
			if (group[3] !== undefined) regex = new RegExp(group[3], group[4]);
			else {
				from = at + Number(group[1]) - 1;
				to = group[2] ? at + Number(group[2]) - 1 : from;
			}
		}
		annotations.push({
			name: match[1] ?? "",
			from,
			to,
			regex,
			value: rest.trim(),
		});
	}
	return { lines, annotations };
}

/** Source with annotation lines removed: `.md` twins, search text, anywhere text leaves the page. */
export function stripAnnotations(source: string, lang: string): string {
	return parseAnnotations(source, lang).lines.join("\n");
}

/**
 * A fence as the `.md` twin and search text carry it. Callouts stay as plain
 * comments directly above the line they target (a `text` fence is program
 * output, so its callouts go); a fence with `!diff` lines becomes a unified
 * `diff` fence. Every other annotation is a rendering hint and is dropped.
 */
export function markdownFence(
	info: string,
	body: string,
): { info: string; body: string } {
	const { lang, title } = parseFenceOptions(info);
	const { lines, annotations } = parseAnnotations(body, lang);
	const token = lang === "text" ? undefined : COMMENT_TOKEN[lang];
	const signs = new Map<number, "+" | "-">();
	for (const a of annotations) {
		if (a.name !== "diff" || (a.value !== "+" && a.value !== "-")) continue;
		for (let i = a.from; i <= a.to; i++) signs.set(i, a.value);
	}
	const isDiff = signs.size > 0;
	const out: string[] = [];
	lines.forEach((line, i) => {
		if (token)
			for (const a of annotations)
				if (a.name === "callout" && a.from === i)
					out.push(
						`${isDiff ? "  " : ""}${/^\s*/.exec(line)?.[0]}${token} ${a.value}`,
					);
		out.push(isDiff ? `${signs.get(i) ?? " "} ${line}` : line);
	});
	return {
		info: isDiff ? `diff${title ? ` ${title}` : ""}` : info,
		body: out.join("\n"),
	};
}
