/**
 * Which names in a line of code the tip table knows: SDK method paths and
 * exported types in TypeScript, endpoint paths in shell commands. Plain JS so
 * the remark plugin (loaded by Node, not the bundler) shares it with the
 * renderer. Comments and, in TypeScript, string literals never match: a word
 * in prose is not a reference.
 */

/**
 * @typedef {{ kind: "method" | "type" | "endpoint" }} TipLike
 * @typedef {{ symbols: Record<string, TipLike>, endpoints: { path: string }[] }} TipTable
 * @typedef {{ start: number, end: number, name: string, kind: "method" | "type" | "endpoint" }} TipHit
 */

const IDENT_CHAIN = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g;
const ENDPOINT_PATH = /\/(?:v1|api)(?:\/[^\s"'`?#\\)]*)?/g;

const SOURCE_LANGS = new Set([
	"typescript",
	"ts",
	"tsx",
	"javascript",
	"js",
	"node",
	"nodejs",
	"node.js",
]);
const SHELL_LANGS = new Set([
	"bash",
	"sh",
	"shell",
	"shellscript",
	"curl",
	"zsh",
]);

/** @param {string} lang @returns {"source" | "shell" | null} */
function familyOf(lang) {
	const lower = lang.toLowerCase();
	if (SOURCE_LANGS.has(lower)) return "source";
	if (SHELL_LANGS.has(lower)) return "shell";
	return null;
}

/**
 * The line with its comment tail and, for source, its string literals blanked
 * to spaces, so offsets still index the original. Strings are kept in shell:
 * an endpoint usually sits inside a quoted URL.
 * @param {string} line
 * @param {"source" | "shell"} family
 * @returns {{ masked: string, comment: boolean }}
 */
function mask(line, family) {
	const out = line.split("");
	const blank = (from, to) => {
		for (let i = from; i < to; i++) out[i] = " ";
	};
	/** @type {string | null} */
	let quote = null;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === "\\" && quote !== "'") {
				if (family === "source") blank(i, i + 2);
				i++;
			} else if (c === quote) {
				if (family === "source") blank(i, i + 1);
				quote = null;
			} else if (family === "source") blank(i, i + 1);
			continue;
		}
		if (family === "source") {
			if (c === "/" && line[i + 1] === "/") {
				blank(i, line.length);
				return { masked: out.join(""), comment: true };
			}
			if (c === "/" && line[i + 1] === "*") {
				const close = line.indexOf("*/", i + 2);
				const to = close < 0 ? line.length : close + 2;
				blank(i, to);
				i = to - 1;
				if (close < 0) return { masked: out.join(""), comment: true };
				continue;
			}
			if (c === '"' || c === "'" || c === "`") {
				quote = c;
				blank(i, i + 1);
			}
		} else {
			if (c === "#" && (i === 0 || /\s/.test(line[i - 1] ?? ""))) {
				blank(i, line.length);
				return { masked: out.join(""), comment: true };
			}
			if (c === '"' || c === "'") quote = c;
		}
	}
	return { masked: out.join(""), comment: false };
}

/**
 * Whether code carries a comment: its own line, or a tail after code. A line
 * the author explained already needs no tip.
 * @param {string} line @param {string} lang
 */
export function hasComment(line, lang) {
	const family = familyOf(lang);
	return family ? mask(line, family).comment : false;
}

/** @param {string} path */
const literalSegments = (path) =>
	path.split("/").filter((s) => s && !s.startsWith("{")).length;

/** @param {string} path */
function templatePattern(path) {
	const body = path
		.split("/")
		.map((s) =>
			s.startsWith("{") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("/");
	return new RegExp(`^${body}$`);
}

/** @type {WeakMap<object, { path: string, pattern: RegExp }[]>} */
const compiled = new WeakMap();

/**
 * Endpoint templates, most specific first, compiled once per table.
 * @param {TipTable} table
 */
function endpointPatterns(table) {
	let found = compiled.get(table);
	if (!found) {
		found = table.endpoints
			.map((e) => ({ path: e.path, pattern: templatePattern(e.path) }))
			.sort(
				(a, b) =>
					literalSegments(b.path) - literalSegments(a.path) ||
					b.path.length - a.path.length,
			);
		compiled.set(table, found);
	}
	return found;
}

/**
 * The longest dotted prefix of `chain` the table knows, or its first identifier.
 * @param {string} chain @param {TipTable} table
 */
function symbolIn(chain, table) {
	const parts = chain.split(".");
	for (let n = parts.length; n > 1; n--) {
		const path = parts.slice(0, n).join(".");
		if (Object.hasOwn(table.symbols, path)) return path;
	}
	const first = parts[0] ?? "";
	return Object.hasOwn(table.symbols, first) ? first : null;
}

/**
 * Every name in one line the table knows, in order. A hit's `name` is the key
 * the table holds it under (an endpoint's is its path template).
 * @param {string} line @param {string} lang @param {TipTable} table
 * @returns {TipHit[]}
 */
export function scanLine(line, lang, table) {
	const family = familyOf(lang);
	if (!family) return [];
	const { masked } = mask(line, family);
	/** @type {TipHit[]} */
	const out = [];
	if (family === "source") {
		for (const m of masked.matchAll(IDENT_CHAIN)) {
			if (masked[m.index - 1] === ".") continue;
			const name = symbolIn(m[0], table);
			const tip = name ? table.symbols[name] : undefined;
			if (name && tip)
				out.push({
					start: m.index,
					end: m.index + name.length,
					name,
					kind: tip.kind,
				});
		}
	} else {
		for (const m of masked.matchAll(ENDPOINT_PATH)) {
			const path = m[0].replace(/[.,;]+$/, "");
			const hit = endpointPatterns(table).find((e) => e.pattern.test(path));
			if (hit)
				out.push({
					start: m.index,
					end: m.index + path.length,
					name: hit.path,
					kind: "endpoint",
				});
		}
	}
	return out;
}
