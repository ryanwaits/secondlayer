import type { Annotation, ParsedCode } from "@/lib/code/annotations";
import type { ThemedToken } from "@/lib/highlight";
import { type CSSProperties, Fragment, type ReactNode } from "react";

export type Variant = "docs" | "figure";

/** A token range on one line, in indexes of the text the row displays. */
export type MarkRange = {
	start: number;
	end: number;
	kind: "hi" | "act" | "bad";
};

export type LinePlan = {
	ranges: MarkRange[];
	/** `!mark` without a selector: the whole row takes the soft fill. */
	mline: boolean;
	diff?: "+" | "-";
	dim: boolean;
	callouts: { col: number; text: string }[];
};

export type Plan = {
	lines: LinePlan[];
	focus: boolean;
	collapses: { from: number; to: number }[];
	hasDiff: boolean;
};

type Context = {
	/** The text each row displays, after any shell prompt is split off. */
	display: string[];
	lang: string;
	variant: Variant;
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

function markKind(a: Annotation, ctx: Context): MarkRange["kind"] {
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

/**
 * Turn the parsed annotations into what each row needs: mark ranges, soft rows,
 * diff signs, dimming, callouts and fold ranges. Unknown names are ignored here
 * and reported by the budget test.
 */
export function planAnnotations(parsed: ParsedCode, ctx: Context): Plan {
	const lines: LinePlan[] = parsed.lines.map(() => ({
		ranges: [],
		mline: false,
		dim: false,
		callouts: [],
	}));
	const focus = new Set<number>();
	const collapses: Plan["collapses"] = [];
	for (const a of parsed.annotations) {
		for (let i = a.from; i <= a.to && i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const hits = matchesOf(a, ctx.display[i] ?? "");
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
				line.callouts.push({ col: hits[0]?.index ?? 0, text: a.value });
			} else if (a.name === "focus") focus.add(i);
			else if (a.name === "diff" && (a.value === "+" || a.value === "-"))
				line.diff = a.value;
		}
		if (a.name === "collapse" && a.from < lines.length)
			collapses.push({ from: a.from, to: Math.min(a.to, lines.length - 1) });
	}
	if (focus.size)
		lines.forEach((line, i) => {
			line.dim = !focus.has(i);
		});
	return {
		lines,
		focus: focus.size > 0,
		collapses: collapses
			.sort((x, y) => x.from - y.from)
			.filter((c, i, all) => i === 0 || c.from > (all[i - 1]?.to ?? -1)),
		hasDiff: lines.some((l) => l.diff),
	};
}

const MARK_TAG = { hi: "mark", act: "mark", bad: "span" } as const;
const MARK_CLASS = { hi: "hi", act: "act", bad: "bad" } as const;

function tokenProps(token: ThemedToken): {
	style?: CSSProperties;
	className?: string;
	key: string;
} {
	const s = token.htmlStyle ?? {};
	const light = s["--shiki-light"];
	const dark = s["--shiki-dark"];
	const bold = s["--shiki-light-font-weight"] === "bold";
	return {
		style:
			light || dark
				? ({ "--shiki-light": light, "--shiki-dark": dark } as CSSProperties)
				: undefined,
		className: bold ? "b" : undefined,
		key: `${light ?? ""}${dark ?? ""}${bold ? "b" : ""}`,
	};
}

type Piece = {
	/** Offset of the piece's first character in the row; also its React key. */
	at: number;
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
				tokenProps(prev.token).key === tokenProps(token).key
			)
				prev.text += text;
			else out.push({ at: a, text, token, range });
		}
		pos = end;
	}
	return out;
}

/** One row's tokens as React nodes, with `!mark` ranges wrapped. */
export function renderTokens(
	tokens: ThemedToken[],
	ranges: MarkRange[],
): ReactNode[] {
	const runs: { range: MarkRange | null; pieces: Piece[] }[] = [];
	for (const piece of pieces(tokens, ranges)) {
		const last = runs.at(-1);
		if (last && last.range === piece.range && piece.range)
			last.pieces.push(piece);
		else runs.push({ range: piece.range, pieces: [piece] });
	}
	return runs.map((run) => {
		const spans = run.pieces.map((piece) => {
			const { key: _key, ...props } = tokenProps(piece.token);
			return props.style || props.className ? (
				<span key={piece.at} {...props}>
					{piece.text}
				</span>
			) : (
				piece.text
			);
		});
		if (!run.range) return <Fragment key={run.pieces[0]?.at}>{spans}</Fragment>;
		const Tag = MARK_TAG[run.range.kind];
		return (
			<Tag key={run.pieces[0]?.at} className={MARK_CLASS[run.range.kind]}>
				{spans}
			</Tag>
		);
	});
}

/** A note under its line, caret at the token's column (monospace makes `ch` exact). */
export function CalloutRow({ col, text }: { col: number; text: string }) {
	return (
		<div className="co" style={{ "--col": col } as CSSProperties}>
			{/* Base sits on the box's top border: the fill hides the border under it, the stroke continues it. */}
			<svg className="co-caret" viewBox="0 0 13 7" aria-hidden="true">
				<path d="M0.5 7 V6.5 L6.5 0.5 L12.5 6.5 V7 Z" />
				<path d="M0.5 6.5 L6.5 0.5 L12.5 6.5" />
			</svg>
			<div className="co-box">{text}</div>
		</div>
	);
}
