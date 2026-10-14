import type { ReactNode } from "react";
import { CodeScope } from "./code-scope";

/**
 * Prose that points at code. `[text](hover:name)` in MDX becomes a mention and
 * `[text](focus:name)` a focus link (see `MdxLink`); both resolve `name`
 * against the `!ref` annotations in the same section. They are plain buttons
 * the page's scope script wakes up, so without JavaScript they read as text.
 */

/** Hover, focus or tap: the matching tokens and rows take the yellow marker. */
export function Mention({
	name,
	children,
}: { name: string; children?: ReactNode }) {
	return (
		<>
			<button type="button" className="mention" data-hover={name}>
				{children}
			</button>
			<CodeScope />
		</>
	);
}

/**
 * Chips that choose the value of a `!pick` token for the whole section, and
 * with it what Copy gives. The options come from the fence that declares them
 * (`!pick[/re/] name: a | b | c`). `default` is that fence's first option: it
 * is the text a reader sees before (or without) JavaScript, and the budget test
 * checks it against the declaration.
 */
export function Pick({
	name,
	default: first,
}: { name: string; default: string }) {
	return (
		<>
			<span className="picker" data-picker={name}>
				{first}
			</span>
			<CodeScope />
		</>
	);
}

/** A prose tip is read in a glance: this many characters at most. */
export const MAX_TIP_TEXT = 120;

/**
 * Why a prose tip's words are not acceptable, or null when they are: required,
 * plain text (a backtick would show), at most two short sentences, no em dash,
 * no URL, no `/docs` path. The budget test reuses this so both fail alike.
 */
export function tipTextProblem(text: string | undefined): string | null {
	const t = text?.trim();
	if (!t) return "has no words";
	if (t.length > MAX_TIP_TEXT)
		return `is ${t.length} characters, max ${MAX_TIP_TEXT}`;
	if (t.includes("\u2014")) return "has an em dash";
	if (t.includes("`")) return "has a backtick, tips are plain text";
	if (/https?:\/\/|www\./.test(t)) return "has a URL";
	if (t.includes("/docs")) return "has a /docs path";
	if ((t.match(/[.!?](?=\s|$)/g) ?? []).length > 2)
		return "has more than two sentences";
	return null;
}

/**
 * `[text](tip "words")`: a word the reader may ask about. Hover or focus shows
 * the author's one line. It never links: the words are all it has. The page's
 * `CodeClient` wakes it.
 */
export function Tip({
	text,
	children,
}: { text?: string; children?: ReactNode }) {
	const problem = tipTextProblem(text);
	if (problem)
		throw new Error(
			`tip "${String(text)}" ${problem} (on "${String(children)}")`,
		);
	return (
		<span
			className="tip"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a tip is read on focus, like a code token's
			tabIndex={0}
			data-tip={JSON.stringify({ summary: text?.trim() })}
		>
			{children}
		</span>
	);
}

/** Blue, because clicking changes the code: it focuses the rows holding `name`. Again clears. */
export function FocusLink({
	name,
	children,
}: { name: string; children?: ReactNode }) {
	return (
		<>
			<button
				type="button"
				className="flink"
				data-focus={name}
				aria-pressed="false"
			>
				{children}
			</button>
			<CodeScope />
		</>
	);
}
