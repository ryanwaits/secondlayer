import { sectionLead } from "@/lib/docs-source";
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

/**
 * `[text](tip:/docs/page#section)`: a word the reader may ask about. Hover or
 * focus shows the first sentence under that heading, read from the page's own
 * MDX at build time, so the tip cannot drift from the section it summarizes.
 * It never links: the words are all it has. The page's `CodeClient` wakes it.
 */
export async function Tip({
	href,
	children,
}: { href: string; children?: ReactNode }) {
	const summary = await sectionLead(href);
	return (
		<span
			className="tip"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a tip is read on focus, like a code token's
			tabIndex={0}
			data-tip={JSON.stringify({ summary })}
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
