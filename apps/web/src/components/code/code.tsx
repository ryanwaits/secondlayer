import {
	copyText,
	parseAnnotations,
	parseFenceOptions,
} from "@/lib/code/annotations";
import { type ThemedToken, tokenize } from "@/lib/highlight";
import { type CSSProperties, Fragment, type ReactNode } from "react";
import "./code.css";
import {
	CalloutRow,
	type Plan,
	type Variant,
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
};

export type CodeProps = {
	code: string;
	/** The fence language as authored (`ts`, `sh`, `text`). */
	lang?: string;
	/** The rest of the fence info string: title and options. */
	meta?: string;
	variant?: Variant;
};

const isShellCommand = (line: string, previous: string | undefined) =>
	line !== "" &&
	!/^\s/.test(line) &&
	!line.startsWith("#") &&
	!(previous !== undefined && /\\$/.test(previous));

/**
 * The one code renderer: fence options and annotation comments in, markup out.
 * Tokens come from Shiki as CSS variables, so React owns the rows and the
 * handlers can wrap lines and tokens. All interactivity is the page's single
 * `CodeClient` listener; nothing here ships JavaScript.
 */
export async function Code({
	code,
	lang = "text",
	meta,
	variant = "docs",
}: CodeProps) {
	const options = parseFenceOptions(`${lang} ${meta ?? ""}`);
	const source = code.replace(/^\n+/, "").trimEnd();
	const parsed = parseAnnotations(source, options.lang);
	const isText = options.lang === "text";
	const isShell = options.lang === "bash";

	// In `text` blocks a leading "$ " is a prompt column, and the rest is shell.
	const prompts = parsed.lines.map((line, i) => {
		if (isText) return line.startsWith("$ ") ? "$" : null;
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
	});
	const tokens: ThemedToken[][] = isText
		? await Promise.all(
				display.map(
					async (text, i) =>
						(await tokenize(text, prompts[i] === "$" ? "bash" : "text"))[0] ??
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

	const row = (i: number) => {
		const line = plan.lines[i];
		if (!line) return null;
		const classes = [
			"row",
			line.mline && "mline",
			line.diff === "+" && "add",
			line.diff === "-" && "del",
			line.dim && "dim",
		]
			.filter(Boolean)
			.join(" ");
		return (
			<Fragment key={i}>
				<div className={classes}>
					{options.lines ? <span className="ln">{i + start}</span> : null}
					{plan.hasDiff ? (
						<span className="sign">
							{line.diff === "+" ? "+" : line.diff === "-" ? "−" : " "}
						</span>
					) : null}
					{prompts[i] != null ? (
						<span className="prompt">{prompts[i]}</span>
					) : null}
					<span className="tx">
						{renderTokens(tokens[i] ?? [], line.ranges)}
					</span>
				</div>
				{line.callouts.map((c) => (
					<CalloutRow key={`${c.col}${c.text}`} col={c.col} text={c.text} />
				))}
			</Fragment>
		);
	};

	const max = options.max ?? DEFAULT_MAX;
	const clampAt = parsed.lines.length - max >= MIN_HIDDEN ? max : null;
	const rows = bodyRows(plan, parsed.lines, row, clampAt);

	const copyable = !options.nocopy && !isText;
	const copy = copyable ? (
		<button type="button" className="copy" data-copy-button>
			Copy
		</button>
	) : null;
	const hasBar = Boolean(options.title) || options.exit != null || plan.focus;
	const bodyStyle = {
		"--gut": `calc(${gutter})`,
		"--lnw": `${lineNumberWidth}ch`,
	} as CSSProperties;
	const body = (
		<div
			className={`cb-body${options.wrap ? " soft-wrap" : ""}`}
			style={bodyStyle}
		>
			{rows}
		</div>
	);

	return (
		<div
			className={hasBar ? "cb" : "cb bare"}
			data-copy={copyable ? copyText(parsed) : undefined}
		>
			{hasBar ? (
				<div className="cb-bar">
					<span>{options.title}</span>
					<span className="r">
						{options.exit != null ? (
							<span className={options.exit ? "exit" : "exit zero"}>
								exit {options.exit}
							</span>
						) : null}
						{isText ? null : (
							<span className="lang">
								{LANG_LABEL[options.lang] ?? options.lang}
							</span>
						)}
						{plan.focus ? (
							<button type="button" className="ghost" data-unfocus>
								Show all
							</button>
						) : null}
						{copy}
					</span>
				</div>
			) : null}
			{body}
			{hasBar ? null : copy}
		</div>
	);
}

/** Rows with `!collapse` ranges folded behind one summary button and rows past `clampAt` behind "Show more". */
function bodyRows(
	plan: Plan,
	lines: string[],
	row: (i: number) => ReactNode,
	clampAt: number | null,
): ReactNode[] {
	const out: ReactNode[] = [];
	const hidden: ReactNode[] = [];
	const push = (node: ReactNode, i: number) =>
		(clampAt !== null && i >= clampAt ? hidden : out).push(node);
	for (let i = 0; i < lines.length; i++) {
		const fold = plan.collapses.find((c) => c.from === i);
		if (!fold) {
			push(row(i), i);
			continue;
		}
		const first = lines[fold.from] ?? "";
		const last = lines[fold.to] ?? "";
		const inner: ReactNode[] = [];
		for (let j = fold.from; j <= fold.to; j++) inner.push(row(j));
		push(
			<Fragment key={`fold-${i}`}>
				<button type="button" className="fold" aria-expanded="false" data-fold>
					<span>{first.match(/^\s*/)?.[0]}</span>
					<span>
						▸ {first.trim()} … {last.trim()}
					</span>
					<span className="cnt">{fold.to - fold.from + 1} lines</span>
				</button>
				<div hidden>{inner}</div>
			</Fragment>,
			i,
		);
		i = fold.to;
	}
	if (clampAt !== null)
		out.push(
			<Fragment key="more">
				<div hidden>{hidden}</div>
				<button type="button" className="more" data-more>
					Show {lines.length - clampAt} more lines
				</button>
			</Fragment>,
		);
	return out;
}
