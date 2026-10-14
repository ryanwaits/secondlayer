import type { Annotation, ParsedCode } from "@/lib/code/annotations";
import { BASE_SWAPS, KEY_SWAP, KEY_VAR } from "@/lib/code/base-url";
import { hasComment, scanLine } from "@/lib/code/tip-scan.mjs";
import type { Tip, TipTable } from "@/lib/code/tip-table";
import type { ThemedToken } from "@/lib/highlight";
import { ladderStep } from "@/lib/syntax-theme";

export type Variant = "docs" | "figure";

/** A token range on one line, in indexes of the text the row displays. */
export type MarkRange = {
	start: number;
	end: number;
	kind: "hi" | "act" | "bad" | "tip" | "err" | "swap" | "ref" | "pick" | "key";
	/** `tip`: what the tooltip and popover show. */
	tip?: TipData;
	/** `ref` and `pick`: the name prose reaches it by. */
	name?: string;
	/** `pick`: the options, on the occurrence that declares them. */
	options?: string[];
	/** `swap`: the index into `BASE_SWAPS` the Base URL switch rewrites. */
	swap?: number;
};

/** A tip's payload: a table entry, or just the words of a hand `!tip`. */
export type TipData = { summary: string } & Partial<Omit<Tip, "summary">>;

export type LinePlan = {
	ranges: MarkRange[];
	/** `!mark` without a selector: the whole row takes the soft fill. */
	mline: boolean;
	diff?: "+" | "-";
	callouts: { col: number; text: string }[];
	/** Compiler messages shown under the row. */
	errors: string[];
	/** `!ref` without a selector: names that point at the whole row. */
	refs: string[];
};

export type Plan = {
	lines: LinePlan[];
	/** Any `!error`: the block shows a mistake, so it never offers Copy. */
	hasError: boolean;
	collapses: { from: number; to: number }[];
	hasDiff: boolean;
};

type Context = {
	/** The text each row displays, after any shell prompt is split off. */
	display: string[];
	lang: string;
	variant: Variant;
	/** Automatic tips: the table, and the names this block may tip. Absent when the block gets none. */
	tips?: { table: TipTable; allow: ReadonlySet<string> } | null;
	/** Wrap the hosted base URL and credential for the Base URL switch. */
	base?: boolean;
	/** Wrap each credential placeholder so a signed-in reader's docs key can fill it. */
	key?: boolean;
};

function matchesOf(a: Annotation, text: string): RegExpExecArray[] {
	if (!a.regex) return [];
	const flags = a.regex.flags.includes("g")
		? a.regex.flags
		: `${a.regex.flags}g`;
	const all = [...text.matchAll(new RegExp(a.regex.source, flags))].filter(
		(m) => m[0].length > 0,
	) as RegExpExecArray[];
	return a.regex.flags.includes("g") ? all : all.slice(0, 1);
}

function markKind(a: Annotation, ctx: Context): "hi" | "act" | "bad" {
	const color = a.value || "yellow";
	if (color === "yellow") return "hi";
	if (color === "blue") {
		if (ctx.variant !== "figure")
			throw new Error("!mark … blue is allowed in figures only");
		return "act";
	}
	if (color === "red") {
		if (ctx.lang !== "text")
			throw new Error("!mark … red is allowed in text output only");
		return "bad";
	}
	throw new Error(`!mark color must be yellow, blue or red, got "${color}"`);
}

const NAME = /^[\w-]+$/;

/** A `!ref` or `!pick` name: a word the prose links to, safe inside an attribute list. */
function refName(a: Annotation, verb: string): string {
	if (!NAME.test(a.value))
		throw new Error(`!${verb} needs a name of letters, digits, - or _`);
	return a.value;
}

/** `event: ft_transfer | nft_mint` declares the options; a bare `event` joins a declared name. */
function parsePick(value: string): { name: string; options?: string[] } {
	const colon = value.indexOf(":");
	const name = (colon < 0 ? value : value.slice(0, colon)).trim();
	if (!NAME.test(name))
		throw new Error("!pick needs a name of letters, digits, - or _");
	if (colon < 0) return { name };
	const options = value
		.slice(colon + 1)
		.split("|")
		.map((o) => o.trim())
		.filter(Boolean);
	if (options.length < 2) throw new Error("!pick needs two or more options");
	return { name, options };
}

const overlaps = (ranges: MarkRange[], start: number, end: number) =>
	ranges.some((r) => start < r.end && end > r.start);

/** Annotations that explain their line: a line carrying one needs no automatic tip. Refs are plumbing, not explanation. */
const EXPLAINS = new Set(["callout", "mark", "error", "tip", "pick", "diff"]);

/**
 * Turn the parsed annotations into what each row needs: mark ranges, soft rows,
 * diff signs, callouts, tips, errors and fold ranges. Unknown names are ignored
 * here and reported by the budget test.
 */
export function planAnnotations(parsed: ParsedCode, ctx: Context): Plan {
	const lines: LinePlan[] = parsed.lines.map(() => ({
		ranges: [],
		mline: false,
		callouts: [],
		errors: [],
		refs: [],
	}));
	/** Spans a callout points at: not drawn, but the names there get no automatic tip, anywhere in the block. */
	const pointed: { row: number; start: number; end: number }[] = [];
	/** Figure callouts mark their token, unless the author already marked it. */
	const noted: { row: number; start: number; end: number }[] = [];
	/** Hand tips wait until every other range is placed: a mark, ref or error on the token wins. */
	const handTips: { row: number; start: number; end: number; text: string }[] =
		[];
	/** Rows an explaining annotation targets. */
	const explained = new Set<number>();
	const collapses: Plan["collapses"] = [];
	let hasError = false;
	for (const a of parsed.annotations) {
		if (EXPLAINS.has(a.name))
			for (let i = a.from; i <= a.to && i < lines.length; i++) explained.add(i);
		let tipped = false;
		for (let i = a.from; i <= a.to && i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const hits = matchesOf(a, ctx.display[i] ?? "");
			const hit = hits[0];
			if (a.name === "mark") {
				const kind = markKind(a, ctx);
				if (!a.regex) line.mline = true;
				for (const m of hits)
					line.ranges.push({
						start: m.index,
						end: m.index + m[0].length,
						kind,
					});
			} else if (a.name === "callout") {
				line.callouts.push({ col: hit?.index ?? 0, text: a.value });
				if (hit && ctx.variant === "figure")
					noted.push({
						row: i,
						start: hit.index,
						end: hit.index + hit[0].length,
					});
				if (hit)
					pointed.push({
						row: i,
						start: hit.index,
						end: hit.index + hit[0].length,
					});
			} else if (a.name === "diff" && (a.value === "+" || a.value === "-"))
				line.diff = a.value;
			else if (a.name === "tip") {
				if (!a.regex || !a.value)
					throw new Error("!tip needs a [/token/] and its text");
				// First occurrence only, within the annotation's lines.
				if (tipped || !hit) continue;
				tipped = true;
				handTips.push({
					row: i,
					start: hit.index,
					end: hit.index + hit[0].length,
					text: a.value,
				});
			} else if (a.name === "ref") {
				const name = refName(a, "ref");
				if (a.regex)
					for (const m of hits)
						line.ranges.push({
							start: m.index,
							end: m.index + m[0].length,
							kind: "ref",
							name,
						});
				else if (!line.refs.includes(name)) line.refs.push(name);
			} else if (a.name === "pick") {
				if (!a.regex) throw new Error("!pick needs a [/token/]");
				const { name, options } = parsePick(a.value);
				if (hit)
					line.ranges.push({
						start: hit.index,
						end: hit.index + hit[0].length,
						kind: "pick",
						name,
						options,
					});
			} else if (a.name === "error") {
				hasError = true;
				const text = ctx.display[i] ?? "";
				if (a.regex)
					for (const m of hits)
						line.ranges.push({
							start: m.index,
							end: m.index + m[0].length,
							kind: "err",
						});
				else if (text.trim())
					line.ranges.push({
						start: text.length - text.trimStart().length,
						end: text.trimEnd().length,
						kind: "err",
					});
			}
		}
		if (a.name === "error" && a.value)
			lines[Math.min(a.to, lines.length - 1)]?.errors.push(a.value);
		if (a.name === "collapse" && a.from < lines.length)
			collapses.push({ from: a.from, to: Math.min(a.to, lines.length - 1) });
	}
	for (const n of noted) {
		const line = lines[n.row];
		if (line && !overlaps(line.ranges, n.start, n.end))
			line.ranges.push({ start: n.start, end: n.end, kind: "hi" });
	}
	if (ctx.base) addBaseSwaps(lines, ctx.display);
	if (ctx.key) addKeySlots(lines, ctx.display);
	for (const t of handTips) {
		const line = lines[t.row];
		if (line && !overlaps(line.ranges, t.start, t.end))
			line.ranges.push({
				start: t.start,
				end: t.end,
				kind: "tip",
				tip: { summary: t.text },
			});
	}
	if (ctx.tips) addAutoTips(lines, ctx, ctx.tips, pointed, explained);
	return {
		lines,
		hasError,
		collapses: collapses
			.sort((x, y) => x.from - y.from)
			.filter((c, i, all) => i === 0 || c.from > (all[i - 1]?.to ?? -1)),
		hasDiff: lines.some((l) => l.diff),
	};
}

/** The hosted origin and credential, wrapped so the Base URL switch can rewrite them. */
function addBaseSwaps(lines: LinePlan[], display: string[]) {
	lines.forEach((line, i) => {
		const text = display[i] ?? "";
		BASE_SWAPS.forEach(([hosted], swap) => {
			for (
				let at = text.indexOf(hosted);
				at >= 0;
				at = text.indexOf(hosted, at + 1)
			)
				if (!overlaps(line.ranges, at, at + hosted.length))
					line.ranges.push({
						start: at,
						end: at + hosted.length,
						kind: "swap",
						swap,
					});
		});
	});
}

/** Each credential placeholder, wrapped so the docs key can take its place. A Base URL swap already holds its own. */
function addKeySlots(lines: LinePlan[], display: string[]) {
	lines.forEach((line, i) => {
		const text = display[i] ?? "";
		for (
			let at = text.indexOf(KEY_VAR);
			at >= 0;
			at = text.indexOf(KEY_VAR, at + 1)
		)
			if (!overlaps(line.ranges, at, at + KEY_VAR.length))
				line.ranges.push({ start: at, end: at + KEY_VAR.length, kind: "key" });
	});
}

/** A table entry as a tip's payload. */
function tipData(table: TipTable, name: string): TipData | null {
	const tip =
		table.symbols[name] ?? table.endpoints.find((e) => e.path === name)?.tip;
	return tip ?? null;
}

/**
 * The names the page allowed become tips: each once per block, never inside
 * another range, never where a callout points (on any line), never on a line
 * the author annotated or commented. One channel per token.
 */
function addAutoTips(
	lines: LinePlan[],
	ctx: Context,
	tips: NonNullable<Context["tips"]>,
	pointed: { row: number; start: number; end: number }[],
	explained: ReadonlySet<number>,
) {
	const scan = (row: number) =>
		scanLine(ctx.display[row] ?? "", ctx.lang, tips.table);
	const shielded = new Set<string>();
	for (const p of pointed)
		for (const hit of scan(p.row))
			if (hit.start < p.end && hit.end > p.start) shielded.add(hit.name);
	const tipped = new Set<string>();
	lines.forEach((line, i) => {
		if (explained.has(i) || hasComment(ctx.display[i] ?? "", ctx.lang)) return;
		for (const hit of scan(i)) {
			if (
				!tips.allow.has(hit.name) ||
				shielded.has(hit.name) ||
				tipped.has(hit.name) ||
				overlaps(line.ranges, hit.start, hit.end)
			)
				continue;
			const data = tipData(tips.table, hit.name);
			if (!data) continue;
			tipped.add(hit.name);
			line.ranges.push({
				start: hit.start,
				end: hit.end,
				kind: "tip",
				tip: data,
			});
		}
	});
}

/**
 * Rows are built as HTML strings, not React elements. A block's rows travel in
 * the page twice (markup and the RSC payload), and a React element per token
 * costs about four times the bytes of a span; a string costs one span. Every
 * dynamic value goes through `esc`.
 */
export const esc = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `esc` for a value inside a quoted attribute. */
export const escAttr = (text: string) => esc(text).replace(/"/g, "&quot;");

/** A range's wrapper: marks fill, tips explain, errors squiggle, swaps wait for the Base URL switch. */
function wrap(range: MarkRange, inner: string): string {
	switch (range.kind) {
		case "hi":
		case "act":
			return `<mark class="${range.kind}">${inner}</mark>`;
		case "bad":
			return `<span class="bad">${inner}</span>`;
		case "err":
			return `<span class="squig">${inner}</span>`;
		// The credential slot is blocked from PostHog autocapture and replay (`ph-no-capture`).
		case "swap":
			return range.swap === KEY_SWAP
				? `<span class="ph-no-capture" data-key-slot data-swap="${range.swap}">${inner}</span>`
				: `<span data-swap="${range.swap}">${inner}</span>`;
		case "key":
			return `<span class="ph-no-capture" data-key-slot>${inner}</span>`;
		// Invisible until the scope script lights it.
		case "ref":
			return `<span class="ref" data-ref="${escAttr(range.name ?? "")}">${inner}</span>`;
		case "pick": {
			const opts = range.options
				? ` data-opts="${escAttr(range.options.join("|"))}"`
				: "";
			return `<mark class="hi" data-pick="${escAttr(range.name ?? "")}"${opts}>${inner}</mark>`;
		}
		// The payload rides in an attribute, not as child text: Copy reads the row's text.
		case "tip":
			return `<span class="tip" tabindex="0" data-tip="${escAttr(JSON.stringify(range.tip))}">${inner}</span>`;
	}
}

/** The token's color: a class for a ladder step, inline custom properties for anything else. */
function styleOf(token: ThemedToken): {
	cls: string;
	style: string;
	key: string;
} {
	const s = token.htmlStyle ?? {};
	const light = s["--shiki-light"];
	const dark = s["--shiki-dark"];
	const bold = s["--shiki-light-font-weight"] === "bold";
	const step = light || dark ? ladderStep(light, dark) : null;
	const off = (light || dark) && !step;
	const cls = [step && `t-${step}`, off && "t-x", bold && "b"]
		.filter(Boolean)
		.join(" ");
	const style = off
		? ` style="--shiki-light:${escAttr(light ?? "")};--shiki-dark:${escAttr(dark ?? "")}"`
		: "";
	return { cls, style, key: `${cls}${style}` };
}

type Piece = {
	text: string;
	token: ThemedToken;
	range: MarkRange | null;
};

/** Cut tokens at range edges, keeping each half's color, then merge neighbours of equal style. */
function pieces(tokens: ThemedToken[], ranges: MarkRange[]): Piece[] {
	const sorted = [...ranges]
		.sort((a, b) => a.start - b.start)
		.filter((r, i, all) => i === 0 || r.start >= (all[i - 1]?.end ?? 0));
	const cuts = new Set<number>();
	for (const r of sorted) {
		cuts.add(r.start);
		cuts.add(r.end);
	}
	const out: Piece[] = [];
	let pos = 0;
	for (const token of tokens) {
		const end = pos + token.content.length;
		const edges = [
			pos,
			...[...cuts].filter((c) => c > pos && c < end).sort((a, b) => a - b),
			end,
		];
		for (let i = 0; i < edges.length - 1; i++) {
			const a = edges[i] as number;
			const b = edges[i + 1] as number;
			if (b === a) continue;
			const range = sorted.find((r) => a >= r.start && b <= r.end) ?? null;
			const prev = out.at(-1);
			const text = token.content.slice(a - pos, b - pos);
			if (
				prev &&
				prev.range === range &&
				styleOf(prev.token).key === styleOf(token).key
			)
				prev.text += text;
			else out.push({ text, token, range });
		}
		pos = end;
	}
	return out;
}

/** One row's tokens as markup, with ranges wrapped. */
export function renderTokens(
	tokens: ThemedToken[],
	ranges: MarkRange[],
): string {
	const runs: { range: MarkRange | null; pieces: Piece[] }[] = [];
	for (const piece of pieces(tokens, ranges)) {
		const last = runs.at(-1);
		if (last && last.range === piece.range && piece.range)
			last.pieces.push(piece);
		else runs.push({ range: piece.range, pieces: [piece] });
	}
	return runs
		.map((run) => {
			const spans = run.pieces
				.map((piece) => {
					// Whitespace takes no color, so it takes no span.
					const { cls, style } = piece.text.trim()
						? styleOf(piece.token)
						: { cls: "", style: "" };
					return cls || style
						? `<span${cls ? ` class="${cls}"` : ""}${style}>${esc(piece.text)}</span>`
						: esc(piece.text);
				})
				.join("");
			return run.range ? wrap(run.range, spans) : spans;
		})
		.join("");
}

/** A note under its line, caret at the token's column (monospace makes `ch` exact). */
export function calloutRow(col: number, text: string): string {
	// The caret's base sits on the box's top border: the fill hides the border under it, the stroke continues it.
	return `<div class="co" style="--col:${col}"><svg class="co-caret" viewBox="0 0 13 7" aria-hidden="true"><path d="M0.5 7 V6.5 L6.5 0.5 L12.5 6.5 V7 Z"/><path d="M0.5 6.5 L6.5 0.5 L12.5 6.5"/></svg><div class="co-box">${esc(text)}</div></div>`;
}

/** A figure's margin note: pinned to its row by index, the line number saying which one. */
export function figureNote(row: number, line: number, text: string): string {
	return `<p class="cf-note" style="--i:${row}"><b>${line}</b><span>${esc(text)}</span></p>`;
}

/** The compiler's words under the line it rejects. */
export function errorRow(text: string): string {
	return `<div class="emsg">✗ ${esc(text)}</div>`;
}
