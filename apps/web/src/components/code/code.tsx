import { parseAnnotations, parseFenceOptions } from "@/lib/code/annotations";
import { KEY_PLACEHOLDERS, KEY_SWAP, docsKeyCanRun } from "@/lib/code/base-url";
import { outputTone } from "@/lib/code/output";
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
const MIN_HIDDEN = 4;

const LANG_LABEL: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	bash: "sh",
	solidity: "sol",
};

export type CodeProps = {
	code: string;
	lang?: string;
	meta?: string;
	title?: string;
	variant?: Variant;
	tips?: readonly string[];
	tabbed?: boolean;
};

const statusTone = (status: number) =>
	status < 300 ? "ok" : status >= 400 ? "bad" : "";

const isShellCommand = (line: string, previous: string | undefined) =>
	line !== "" &&
	!/^\s/.test(line) &&
	!line.startsWith("#") &&
	!(previous !== undefined && /\\$/.test(previous));

export type RenderedCode = {
	className: string;
	copyable: boolean;
	hasKey: boolean;
	html: string;
	notes: string;
	noteTop: string;
	keyed: boolean;
	margin: boolean;
};

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
	if (figure && options.lang !== "text" && !options.lines) options.lines = 1;
	const source = code.replace(/^\n+/, "").trimEnd();
	const parsed = parseAnnotations(source, options.lang);
	const isText = options.lang === "text";
	const isShell = options.lang === "bash";

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
			const command = !quoted && isShellCommand(line, parsed.lines[i - 1]);
			if ((line.split("'").length - 1) % 2 === 1) quoted = !quoted;
			return command ? "$" : "";
		}
		return null;
	});
	const display = parsed.lines.map((line, i) =>
		isText && prompts[i] === "$" ? line.slice(2) : line,
	);

	// Only a block Copy can take from carries a key slot; output never does, and
	// neither does a sample the docs key would be refused on.
	const hasKey =
		!options.nocopy &&
		!options.nokey &&
		docsKeyCanRun(source) &&
		!isText &&
		display.some((l) => KEY_PLACEHOLDERS.some((p) => l.includes(p)));
	// The table is ~240 KB of docs data; only blocks that ask for tips load it.
	const tipTable =
		tips?.length && !isText
			? (await import("@/lib/code/tip-table")).tipTable
			: null;
	const plan = planAnnotations(parsed, {
		key: hasKey,
		display,
		lang: options.lang,
		variant,
		tips: tipTable && tips ? { table: tipTable, allow: new Set(tips) } : null,
		base: options.base,
	});
	// Notes sit beside rows by index, so nothing may change a row's height or hide one.
	if (figure && (options.wrap || plan.collapses.length || plan.hasError))
		throw new Error("figures take no wrap, !collapse or !error");
	const notes: string[] = [];
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

	const hanging =
		isShell && hasPrompt && !options.lines && !plan.hasDiff && !options.wrap;
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
	const barTitle = title ?? options.title;
	const hasBar =
		!tabbed &&
		(Boolean(barTitle) || options.exit != null || options.status != null);
	// Hidden until the page knows who is reading (never server-rendered visible).
	const useKey = copyable && hasKey && !tabbed && hasBar ? KEY_CONTROLS : "";
	const bareKey = copyable && hasKey && !tabbed && !hasBar;
	const keyLine = plan.lines.findIndex((l) =>
		l.ranges.some(
			(r) => r.kind === "key" || (r.kind === "swap" && r.swap === KEY_SWAP),
		),
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
		noteTop: tabbed ? "12px" : hasBar ? "calc(var(--bar) + 13px)" : "13px",
	};
}

export const frameOf = (r: RenderedCode) =>
	`<div class="${r.className}"${r.copyable ? " data-copyable" : ""}>${r.html}</div>`;

const figureClass = (r: RenderedCode) =>
	`cf${r.keyed ? " key" : ""}${r.keyed && !r.margin ? " under" : ""}`;

export const figureOf = (r: RenderedCode) =>
	r.notes
		? `<div class="${figureClass(r)}" style="--nt:${r.noteTop}">${frameOf(r)}<div class="cf-notes">${r.notes}</div></div>`
		: frameOf(r);

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
