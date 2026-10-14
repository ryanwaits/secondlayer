import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * JSDoc prose as the extractor leaves it: paragraphs, `inline code` and
 * `[label](href)` links, nothing else (a test over the generated files keeps
 * it that way). Rendered as elements, never as injected HTML.
 */
const INLINE = /\[((?:[^\]\\]|\\.)*)\]\(([^)\s]+)\)|`([^`]+)`/g;

export type Piece =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "link"; label: Piece[]; href: string };

export function parseInline(text: string): Piece[] {
	const out: Piece[] = [];
	let at = 0;
	for (const m of text.matchAll(INLINE)) {
		if (m.index > at) out.push({ kind: "text", text: text.slice(at, m.index) });
		if (m[3] !== undefined) out.push({ kind: "code", text: m[3] });
		else
			out.push({
				kind: "link",
				label: parseInline(m[1] ?? ""),
				href: m[2] as string,
			});
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
	return out;
}

/** Prose without its markup: the text of a box that is itself a link. */
export function plain(text: string): string {
	return text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`/g, "")
		.replace(/\s*\n\s*/g, " ")
		.trim();
}

/** Paragraphs of a doc comment; line breaks inside one are spaces. */
export function paragraphs(text: string): string[] {
	return text
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s*\n\s*/g, " ").trim())
		.filter(Boolean);
}

function Inline({ pieces }: { pieces: Piece[] }): ReactNode {
	return pieces.map((piece, i) => {
		const key = `${i}:${piece.kind}`;
		if (piece.kind === "code") return <code key={key}>{piece.text}</code>;
		if (piece.kind === "text")
			return <Fragment key={key}>{piece.text}</Fragment>;
		return piece.href.startsWith("/") || piece.href.startsWith("#") ? (
			<Link key={key} href={piece.href}>
				<Inline pieces={piece.label} />
			</Link>
		) : (
			<a key={key} href={piece.href} target="_blank" rel="noreferrer">
				<Inline pieces={piece.label} />
			</a>
		);
	});
}

/** One line of prose: a cell, a caption. */
export function Text({ text }: { text: string }) {
	return <Inline pieces={parseInline(text.replace(/\s*\n\s*/g, " ").trim())} />;
}

/** A doc comment as paragraphs. */
export function Paragraphs({
	text,
	className,
}: { text: string; className?: string }) {
	return paragraphs(text).map((p) => (
		<p key={p} className={className}>
			<Inline pieces={parseInline(p)} />
		</p>
	));
}
