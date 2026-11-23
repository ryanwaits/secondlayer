import type { ReactNode } from "react";
import { CodeScope } from "./code-scope";

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

export const MAX_TIP_TEXT = 120;

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
