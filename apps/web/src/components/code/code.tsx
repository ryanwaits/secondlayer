import { parseAnnotations, parseFenceOptions } from "@/lib/code/annotations";
import { KEY_PLACEHOLDERS } from "@/lib/code/base-url";
import { outputTone } from "@/lib/code/output";
import { tipTable } from "@/lib/code/tip-table";
import { type ThemedToken, tokenize } from "@/lib/highlight";
import type { CSSProperties } from "react";
import "./code.css";
import {
	KEY_CONTROLS,
	type Plan,
	type Variant,
	calloutRow,
	errorRow,
	esc,
	escAttr,
	figureNote,
	marginNote,
	planAnnotations,
	renderTokens,
} from "./handlers";

const DEFAULT_MAX = 30;
/** Hiding fewer lines than this is not worth a "Show more" button. */
const MIN_HIDDEN = 4;

const LANG_LABEL: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	bash: "sh",
	solidity: "sol",
};

export type CodeProps = {
	code: string;
	/** The fence language as authored (`ts`, `sh`, `text`). */
	lang?: string;
	/** The rest of the fence info string: title and options. */
	meta?: string;
	/** A bar title the fence info string cannot spell (words, not a path). */
	title?: string;
	variant?: Variant;
	/**
	 * The names that may carry an automatic tip (SDK methods, types, endpoint
	 * path templates). Absent: none, so a block tips only what its author wrote
	 * with `!tip`. The page decides which (remark-code-tips.mjs, the reference).
	 */
	tips?: readonly string[];
	/** Inside `<CodeTabs>`: the tab group draws the frame, the bar and Copy. */
	tabbed?: boolean;
};

/** 2xx is ok, 4xx and 5xx alarm, anything between stays quiet. */
const statusTone = (status: number) =>
	status < 300 ? "ok" : status >= 400 ? "bad" : "";

const isShellCommand = (line: string, previous: string | undefined) =>
	line !== "" &&
	!/^\s/.test(line) &&
	!line.startsWith("#") &&
	!(previous !== undefined && /\\$/.test(previous));

/** A block as markup: its frame's classes and everything inside it as one string. */
export type RenderedCode = {
	className: string;
	/** Whether Copy has anything to give. */
	copyable: boolean;
	/** Whether the block names `$SECONDLAYER_API_KEY`, so a signed-in reader can fill it. */
	hasKey: boolean;
	html: string;
	/** A figure's margin notes as markup, or "" when it has none. */
	notes: string;
	/** Where the first row starts below the figure's top edge, for the notes to align to. */
	noteTop: string;
	/** Whether a bare block's docs key controls live in a margin note beside it instead of its frame. */
	keyed: boolean;
	/** Whether the key note may sit in the page margin: its row index lines up with its line. */
	margin: boolean;
};

/**
 * The one code renderer: fence options and annotation comments in, markup out.
 * A block is one HTML string the handlers build, so it costs the page one
 * element and one span per token (a React element per token is about four times
 * the bytes, and a block travels in the page twice, as markup and as RSC
 * payload). Tokens carry their color as a ladder class. All interactivity is the
 * page's single `CodeClient` listener; nothing here ships JavaScript.
 */
export async function renderCode({
	code,
	lang = "text",
	meta,
	title,
	variant = "docs",
	tips,
	tabbed = false,
}: CodeProps): Promise<RenderedCode> {
	const options = parseFenceOptions(`${lang} ${meta ?? ""}`);
	const figure = variant === "figure";
	// Figures number their source; a transcript is not source.
	if (figure && options.lang !== "text" && !options.lines) options.lines = 1;
	const source = code.replace(/^\n+/, "").trimEnd();
	const parsed = parseAnnotations(source, options.lang);
	const isText = options.lang === "text";
	const isShell = options.lang === "bash";

	// In `text` blocks a leading "$ " is a prompt column, and the rest is shell.
	// A `text` command carries on while a line ends in a backslash or a single quote is open.
	let carrying = false;
	let quoted = false;
	const prompts = parsed.lines.map((line, i) => {
		if (isText) {
			const command = line.startsWith("$ ");
			if (!command && !carrying) return null;
			if (command) quoted = false;
			quoted = (line.split("'").length - 1) % 2 === 1 ? !quoted : quoted;
			carrying = quoted || /\\$/.test(line);
			return command ? "$" : "";
		}
		if (isShell) {
			// A line inside an open single quote (a multi-line `--json '…'`) is the argument, not a new command.
			const command = !quoted && isShellCommand(line, parsed.lines[i - 1]);
			if ((line.split("'").length - 1) % 2 === 1) quoted = !quoted;
			return command ? "$" : "";
		}
		return null;
	});
	const display = parsed.lines.map((line, i) =>
		isText && prompts[i] === "$" ? line.slice(2) : line,
	);

	// Only a block Copy can take from carries a key slot; output never does.
	const hasKey =
		!options.nocopy &&
		!isText &&
		display.some((l) => KEY_PLACEHOLDERS.some((p) => l.includes(p)));
	const plan = planAnnotations(parsed, {
		key: hasKey,
		display,
		lang: options.lang,
		variant,
		// Output is never tipped: it is what a command printed, not what to write.
		tips:
			tips?.length && !isText
				? { table: tipTable, allow: new Set(tips) }
				: null,
		base: options.base,
	});
	// Notes sit beside rows by index, so nothing may change a row's height or hide one.
	if (figure && (options.wrap || plan.collapses.length || plan.hasError))
		throw new Error("figures take no wrap, !collapse or !error");
	const notes: string[] = [];
	/** A noted row and its notes share an ordinal, so hovering the token can light its note. */
	const noteOf = new Map<number, number>();
	if (figure)
		plan.lines.forEach((l, i) => {
			if (l.callouts.length) noteOf.set(i, noteOf.size);
		});
	const tokens: ThemedToken[][] = isText
		? await Promise.all(
				display.map(
					async (text, i) =>
						(await tokenize(text, prompts[i] != null ? "bash" : "text"))[0] ??
						[],
				),
			)
		: await tokenize(display.join("\n"), options.lang);

	const start = options.lines ?? 1;
	const lineNumberWidth = String(start + parsed.lines.length - 1).length;
	const hasPrompt = prompts.some((p) => p !== null);
	const gutter = [
		options.lines ? `${lineNumberWidth}ch + 18px` : "0px",
		plan.hasDiff ? "2ch" : "0px",
		hasPrompt ? "2ch" : "0px",
	].join(" + ");

	// A shell block whose only gutter is the prompt hangs it in the row's padding.
	const hanging =
		isShell && hasPrompt && !options.lines && !plan.hasDiff && !options.wrap;
	// Plain rows are just their tokens; a gutter or soft wrap needs the `.tx` column beside it.
	const gutterRows =
		Boolean(options.lines) ||
		plan.hasDiff ||
		Boolean(options.wrap) ||
		(hasPrompt && !hanging);
	const row = (i: number): string => {
		const line = plan.lines[i];
		if (!line) return "";
		const tone =
			isText && prompts[i] == null ? outputTone(display[i] ?? "") : null;
		const classes = [
			"row",
			gutterRows && "g",
			tone && `o-${tone}`,
			line.mline && "mline",
			figure && line.callouts.length && "noted",
			line.diff === "+" && "add",
			line.diff === "-" && "del",
		]
			.filter(Boolean)
			.join(" ");
		return [
			`<div class="${classes}"${noteOf.has(i) ? ` data-note="${noteOf.get(i)}"` : ""}${line.refs.length ? ` data-refs="${escAttr(line.refs.join(" "))}"` : ""}>`,
			options.lines ? `<span class="ln">${i + start}</span>` : "",
			plan.hasDiff
				? `<span class="sign">${line.diff === "+" ? "+" : line.diff === "-" ? "−" : " "}</span>`
				: "",
			prompts[i] != null && !(hanging && !prompts[i])
				? `<span class="prompt">${prompts[i]}</span>`
				: "",
			gutterRows
				? `<span class="tx">${renderTokens(tokens[i] ?? [], line.ranges)}</span></div>`
				: `${renderTokens(tokens[i] ?? [], line.ranges)}</div>`,
			...line.callouts.map((c) => {
				if (!figure) return calloutRow(c.col, c.text);
				notes.push(figureNote(i, i + start, c.text, noteOf.get(i) ?? 0));
				return "";
			}),
			...line.errors.map(errorRow),
		].join("");
	};

	const max = options.max ?? (figure ? Number.POSITIVE_INFINITY : DEFAULT_MAX);
	const clampAt = parsed.lines.length - max >= MIN_HIDDEN ? max : null;
	const rows = bodyRows(plan, parsed.lines, row, clampAt);

	const copyable = !options.nocopy && !isText && !plan.hasError;
	const copy =
		copyable && !tabbed
			? '<button type="button" class="copy" data-copy-button>Copy</button>'
			: "";
	// Hidden until the page knows who is reading (never server-rendered visible).
	const barTitle = title ?? options.title;
	const hasBar =
		!tabbed &&
		(Boolean(barTitle) || options.exit != null || options.status != null);
	const useKey = copyable && hasKey && !tabbed && hasBar ? KEY_CONTROLS : "";
	// A bare block's key controls leave the frame for a margin note on the key's own line.
	const bareKey = copyable && hasKey && !tabbed && !hasBar;
	const keyLine = plan.lines.findIndex((l) =>
		l.ranges.some((r) => r.kind === "key"),
	);
	// Callout, error and fold rows have their own heights, so row-index alignment only holds before them.
	const margin =
		bareKey &&
		keyLine >= 0 &&
		!options.wrap &&
		(clampAt === null || keyLine < clampAt) &&
		!plan.collapses.some((c) => c.from <= keyLine) &&
		!plan.lines
			.slice(0, keyLine)
			.some((l) => l.callouts.length || l.errors.length);
	if (bareKey && keyLine >= 0)
		notes.push(
			marginNote(keyLine, keyLine + start, KEY_CONTROLS, " data-key-note"),
		);
	const body = `<div class="cb-body${options.wrap ? " soft-wrap" : ""}${hanging ? " hang" : ""}" style="--gut:calc(${gutter});--lnw:${lineNumberWidth}ch">${rows}</div>`;
	const bar = hasBar
		? `<div class="cb-bar">${
				options.status != null
					? `<span class="status ${statusTone(options.status)}">${options.status}</span>`
					: ""
			}<span>${esc(barTitle ?? "")}</span><span class="r">${
				options.exit != null
					? `<span class="${options.exit ? "exit" : "exit zero"}">exit ${options.exit}</span>`
					: ""
			}${
				isText
					? ""
					: `<span class="lang">${esc(LANG_LABEL[options.lang] ?? options.lang)}</span>`
			}${useKey}${copy}</span></div>`
		: "";
	return {
		className: tabbed ? "cb tabbed" : hasBar ? "cb" : "cb bare",
		copyable,
		hasKey: copyable && hasKey,
		html: `${bar}${body}${hasBar ? "" : copy}`,
		notes: notes.join(""),
		keyed: bareKey && keyLine >= 0,
		margin,
		// The frame's border, the bar, then the body's padding; a tab group's bar sits outside the pane.
		noteTop: tabbed ? "12px" : hasBar ? "calc(var(--bar) + 13px)" : "13px",
	};
}

/** A block's frame as markup. */
export const frameOf = (r: RenderedCode) =>
	`<div class="${r.className}"${r.copyable ? " data-copyable" : ""}>${r.html}</div>`;

/** A figure's wrapper class: a docs key note makes it `key`, and `under` when it cannot sit in the margin. */
const figureClass = (r: RenderedCode) =>
	`cf${r.keyed ? " key" : ""}${r.keyed && !r.margin ? " under" : ""}`;

/** A figure: the frame beside its notes (`.cf`), or the bare frame when it has none. */
export const figureOf = (r: RenderedCode) =>
	r.notes
		? `<div class="${figureClass(r)}" style="--nt:${r.noteTop}">${frameOf(r)}<div class="cf-notes">${r.notes}</div></div>`
		: frameOf(r);

/** `renderCode` as one element: the block's frame, its contents a single string. */
export async function Code(props: CodeProps) {
	const rendered = await renderCode(props);
	const { className, copyable, html } = rendered;
	if (rendered.notes)
		return (
			<div
				className={figureClass(rendered)}
				style={{ "--nt": rendered.noteTop } as CSSProperties}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: built by `renderCode`, which escapes every dynamic value
				dangerouslySetInnerHTML={{
					__html: `${frameOf(rendered)}<div class="cf-notes">${rendered.notes}</div>`,
				}}
			/>
		);
	return (
		<div
			className={className}
			data-copyable={copyable ? "" : undefined}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: built by `renderCode`, which escapes every dynamic value
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

/** Rows with `!collapse` ranges folded behind one summary button and rows past `clampAt` behind "Show more". */
function bodyRows(
	plan: Plan,
	lines: string[],
	row: (i: number) => string,
	clampAt: number | null,
): string {
	let out = "";
	let hidden = "";
	const push = (html: string, i: number) => {
		if (clampAt !== null && i >= clampAt) hidden += html;
		else out += html;
	};
	for (let i = 0; i < lines.length; i++) {
		const fold = plan.collapses.find((c) => c.from === i);
		if (!fold) {
			push(row(i), i);
			continue;
		}
		const first = lines[fold.from] ?? "";
		const last = lines[fold.to] ?? "";
		let inner = "";
		for (let j = fold.from; j <= fold.to; j++) inner += row(j);
		push(
			`<button type="button" class="fold" aria-expanded="false" data-fold><span>${esc(first.match(/^\s*/)?.[0] ?? "")}</span><span>▸ ${esc(first.trim())} … ${esc(last.trim())}</span><span class="cnt">${fold.to - fold.from + 1} lines</span></button><div hidden>${inner}</div>`,
			i,
		);
		i = fold.to;
	}
	if (clampAt !== null)
		out += `<div hidden>${hidden}</div><button type="button" class="more" data-more>Show ${lines.length - clampAt} more lines</button>`;
	return out;
}
