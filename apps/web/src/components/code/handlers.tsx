import type { Annotation, ParsedCode } from "@/lib/code/annotations";
import { type LinkTable, autoLinks } from "@/lib/code/auto-links";
import { BASE_SWAPS } from "@/lib/code/base-url";
import type { ThemedToken } from "@/lib/highlight";
import { ladderStep } from "@/lib/syntax-theme";

export type Variant = "docs" | "figure";

/** A token range on one line, in indexes of the text the row displays. */
export type MarkRange = {
	start: number;
	end: number;
	kind: "hi" | "act" | "bad" | "link" | "err" | "swap";
	/** `link`: where it goes. */
	href?: string;
	/** `swap`: the index into `BASE_SWAPS` the Base URL switch rewrites. */
	swap?: number;
};

export type LinePlan = {
	ranges: MarkRange[];
	/** `!mark` without a selector: the whole row takes the soft fill. */
	mline: boolean;
	diff?: "+" | "-";
	dim: boolean;
	callouts: { col: number; text: string }[];
	/** Compiler messages shown under the row. */
	errors: string[];
};

export type Plan = {
	lines: LinePlan[];
	focus: boolean;
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
	/** Automatic reference links; absent when the block must not link. */
	links?: LinkTable | null;
	/** Wrap the hosted base URL and credential for the Base URL switch. */
	base?: boolean;
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

const overlaps = (ranges: MarkRange[], start: number, end: number) =>
	ranges.some((r) => start < r.end && end > r.start);

/**
 * Turn the parsed annotations into what each row needs: mark ranges, soft rows,
 * diff signs, dimming, callouts, links, errors and fold ranges. Unknown names
 * are ignored here and reported by the budget test.
 */
export function planAnnotations(parsed: ParsedCode, ctx: Context): Plan {
	const lines: LinePlan[] = parsed.lines.map(() => ({
		ranges: [],
		mline: false,
		dim: false,
		callouts: [],
		errors: [],
	}));
	/** Spans a callout points at: not drawn, but no automatic link goes there. */
	const pointed: { row: number; start: number; end: number }[] = [];
	const focus = new Set<number>();
	const collapses: Plan["collapses"] = [];
	let hasError = false;
	for (const a of parsed.annotations) {
		let linked = false;
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
				if (hit)
					pointed.push({
						row: i,
						start: hit.index,
						end: hit.index + hit[0].length,
					});
			} else if (a.name === "focus") focus.add(i);
			else if (a.name === "diff" && (a.value === "+" || a.value === "-"))
				line.diff = a.value;
			else if (a.name === "link") {
				if (!a.regex || !a.value)
					throw new Error("!link needs a [/token/] and a destination");
				// First occurrence only, within the annotation's lines.
				if (linked || !hit) continue;
				linked = true;
				line.ranges.push({
					start: hit.index,
					end: hit.index + hit[0].length,
					kind: "link",
					href: a.value,
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
	if (focus.size)
		lines.forEach((line, i) => {
			line.dim = !focus.has(i);
		});
	if (ctx.base) addBaseSwaps(lines, ctx.display);
	if (ctx.links) addAutoLinks(lines, ctx, ctx.links, pointed);
	return {
		lines,
		focus: focus.size > 0,
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

/** Names the reference knows become links, once per block, never inside another range. */
function addAutoLinks(
	lines: LinePlan[],
	ctx: Context,
	table: LinkTable,
	pointed: { row: number; start: number; end: number }[],
) {
	const linked = new Set<string>();
	lines.forEach((line, i) => {
		const found = autoLinks(
			ctx.display[i] ?? "",
			ctx.lang,
			table,
			linked,
			(start, end) =>
				overlaps(line.ranges, start, end) ||
				pointed.some((p) => p.row === i && start < p.end && end > p.start),
		);
		for (const l of found)
			line.ranges.push({
				start: l.start,
				end: l.end,
				kind: "link",
				href: l.href,
			});
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

/** A range's wrapper: marks fill, links go, errors squiggle, swaps wait for the Base URL switch. */
function wrap(range: MarkRange, inner: string): string {
	switch (range.kind) {
		case "hi":
		case "act":
			return `<mark class="${range.kind}">${inner}</mark>`;
		case "bad":
			return `<span class="bad">${inner}</span>`;
		case "err":
			return `<span class="squig">${inner}</span>`;
		case "swap":
			return `<span data-swap="${range.swap}">${inner}</span>`;
		case "link": {
			const href = range.href ?? "";
			// Internal links navigate through the router (CodeClient); others open a new tab.
			const external = /^[/#]/.test(href)
				? ""
				: ' target="_blank" rel="noopener noreferrer"';
			return `<a class="lk" href="${escAttr(href)}"${external}>${inner}</a>`;
		}
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

/** The compiler's words under the line it rejects. */
export function errorRow(text: string): string {
	return `<div class="emsg">✗ ${esc(text)}</div>`;
}
