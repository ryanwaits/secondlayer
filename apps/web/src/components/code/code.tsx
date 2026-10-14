import { parseAnnotations, parseFenceOptions } from "@/lib/code/annotations";
import { linkTable } from "@/lib/code/link-table";
import { outputTone } from "@/lib/code/output";
import { type ThemedToken, tokenize } from "@/lib/highlight";
import type { CSSProperties } from "react";
import "./code.css";
import {
	type Plan,
	type Variant,
	calloutRow,
	errorRow,
	esc,
	escAttr,
	figureNote,
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
	/** Link SDK symbols and endpoint paths to the reference. On unless the surface is the reference. */
	links?: boolean;
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
	html: string;
	/** A figure's margin notes as markup, or "" when it has none. */
	notes: string;
	/** Where the first row starts below the figure's top edge, for the notes to align to. */
	noteTop: string;
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
	links = true,
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
		if (isShell) return isShellCommand(line, parsed.lines[i - 1]) ? "$" : "";
		return null;
	});
	const display = parsed.lines.map((line, i) =>
		isText && prompts[i] === "$" ? line.slice(2) : line,
	);

	const plan = planAnnotations(parsed, {
		display,
		lang: options.lang,
		variant,
		// Output is never linked: it is what a command printed, not what to write.
		links: links && !isText ? linkTable() : null,
		base: options.base,
	});
	// Notes sit beside rows by index, so nothing may change a row's height or hide one.
	if (figure && (options.wrap || plan.collapses.length || plan.hasError))
		throw new Error("figures take no wrap, !collapse or !error");
	const notes: string[] = [];
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
			line.dim && "dim",
		]
			.filter(Boolean)
			.join(" ");
		return [
			`<div class="${classes}"${line.refs.length ? ` data-refs="${escAttr(line.refs.join(" "))}"` : ""}>`,
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
				notes.push(figureNote(i, i + start, c.text));
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
	const barTitle = title ?? options.title;
	const hasBar =
		!tabbed &&
		(Boolean(barTitle) ||
			options.exit != null ||
			options.status != null ||
			plan.focus);
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
			}${
				plan.focus
					? '<button type="button" class="ghost" data-unfocus>Show all</button>'
					: ""
			}${copy}</span></div>`
		: "";
	return {
		className: tabbed ? "cb tabbed" : hasBar ? "cb" : "cb bare",
		copyable,
		html: `${bar}${body}${hasBar ? "" : copy}`,
		notes: notes.join(""),
		// The frame's border, the bar, then the body's padding; a tab group's bar sits outside the pane.
		noteTop: tabbed ? "12px" : hasBar ? "calc(var(--bar) + 13px)" : "13px",
	};
}

/** A block's frame as markup. */
export const frameOf = (r: RenderedCode) =>
	`<div class="${r.className}"${r.copyable ? " data-copyable" : ""}>${r.html}</div>`;

/** A figure: the frame beside its notes (`.cf`), or the bare frame when it has none. */
export const figureOf = (r: RenderedCode) =>
	r.notes
		? `<div class="cf" style="--nt:${r.noteTop}">${frameOf(r)}<div class="cf-notes">${r.notes}</div></div>`
		: frameOf(r);

/** `renderCode` as one element: the block's frame, its contents a single string. */
export async function Code(props: CodeProps) {
	const rendered = await renderCode(props);
	const { className, copyable, html } = rendered;
	if (rendered.notes)
		return (
			<div
				className="cf"
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
