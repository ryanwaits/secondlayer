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
