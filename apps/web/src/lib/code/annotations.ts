import { normalizeLang } from "../highlight";

export const ANNOTATION_NAMES = [
	"mark",
	"callout",
	"diff",
	"collapse",
	"tip",
	"error",
	"ref",
	"pick",
] as const;

export const ANNOTATION_LIMITS = { mark: 2, callout: 3, tip: 2 } as const;

export type FenceOptions = {
	lang: string;
	title?: string;
	lines?: number;
	nocopy?: boolean;
	nokey?: boolean;
	wrap?: boolean;
	max?: number;
	exit?: number;
	status?: number;
	base?: boolean;
	figure?: boolean;
};

export function parseFenceOptions(info: string): FenceOptions {
	const [first = "", ...rest] = info.trim().split(/\s+/);
	const options: FenceOptions = { lang: normalizeLang(first) };
	for (const token of rest) {
		const [key, value] = token.split("=");
		if (key === "lines") options.lines = value ? Number(value) : 1;
		else if (key === "nocopy") options.nocopy = true;
		else if (key === "nokey") options.nokey = true;
		else if (key === "wrap") options.wrap = true;
		else if (key === "max") options.max = Number(value);
		else if (key === "exit") options.exit = Number(value);
		else if (key === "status") options.status = Number(value);
		else if (key === "base") options.base = true;
		else if (key === "figure") options.figure = true;
		else if (!options.title && !value && /[./~]/.test(token))
			options.title = token;
	}
	return options;
}

export type Annotation = {
	name: string;
	from: number;
	to: number;
	regex: RegExp | null;
	value: string;
};

export type ParsedCode = {
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

export function stripAnnotations(source: string, lang: string): string {
	return parseAnnotations(source, lang).lines.join("\n");
}

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
