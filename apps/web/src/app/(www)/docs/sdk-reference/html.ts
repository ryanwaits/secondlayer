import { esc, escAttr } from "@/components/code/handlers";
import { type Piece, parseInline } from "./markdown-text";
import {
	type Callback,
	type Constant,
	type ErrorLine,
	type Field,
	type Method,
	type ParamGroup,
	type ParamRow,
	type TypeDoc,
	constantAnchor,
	glanceReturn,
	methodAnchor,
	refKey,
	shortType,
	typeAnchor,
} from "./reference";

/**
 * Tables as one escaped HTML string each. A reference page holds hundreds of
 * rows, and a React element per cell travels in the page twice (markup and the
 * RSC payload) at several times a string's bytes; the code blocks already
 * render this way for the same reason. Every dynamic value goes through `esc`.
 */

function piecesHtml(pieces: Piece[], links: boolean): string {
	return pieces
		.map((p) =>
			p.kind === "text"
				? esc(p.text)
				: p.kind === "code"
					? `<code>${esc(p.text)}</code>`
					: links
						? `<a href="${escAttr(p.href)}"${/^[/#]/.test(p.href) ? "" : ' target="_blank" rel="noreferrer"'}>${piecesHtml(p.label, links)}</a>`
						: piecesHtml(p.label, links),
		)
		.join("");
}

/**
 * One line of JSDoc prose (inline code and links) as markup. `links: false`
 * keeps a link's text and drops the anchor, for prose that sits inside a link.
 */
export function inlineHtml(text: string, { links = true } = {}): string {
	return piecesHtml(parseInline(text.replace(/\s*\n\s*/g, " ").trim()), links);
}

/** A box on the overview (it is a link, so its prose carries no links of its own). */
export function mapBoxHtml(
	href: string,
	name: string,
	blurb: string,
	meta?: string,
): string {
	return `<a class="sdkr-box" href="${escAttr(href)}"><b>${esc(name)}</b><span>${inlineHtml(blurb, { links: false })}</span>${meta ? `<em>${esc(meta)}</em>` : ""}</a>`;
}

/** The error family as a preformatted tree; a class without a status says what it is, as inline prose. */
export function errorTreeHtml(
	lines: ErrorLine[],
	href?: (name: string) => string,
): string {
	const rows = lines
		.map((l) => {
			const name = href
				? `<a href="${escAttr(href(l.name))}"><b>${esc(l.name)}</b></a>`
				: `<b>${esc(l.name)}</b>`;
			const note = l.note ? ` ${esc(l.note)}` : "";
			const summary = l.summary
				? ` <span class="sdkr-faint">${inlineHtml(l.summary, { links: false })}</span>`
				: "";
			return `${esc(l.prefix)}${name}${note}${summary}\n`;
		})
		.join("");
	return `<pre class="sdkr-tree">${rows}</pre>`;
}

function paramTable(rows: ParamRow[]): string {
	const body = rows
		.map(
			(row) =>
				`<tr class="mention sdkr-prow" data-hover="${escAttr(refKey(row.name))}"><td class="pn"><code>${esc(row.name)}</code>${row.required ? '<span class="req">required</span>' : ""}<span class="t">${esc(shortType(row.type))}</span>${row.only ? `<span class="only">${esc(row.only)} only</span>` : ""}</td><td class="pd">${row.description ? inlineHtml(row.description) : ""}</td></tr>`,
		)
		.join("");
	return `<table class="sdkr-t sdkr-params"><tbody>${body}</tbody></table>`;
}

/** The parameter groups: required first, options after, the long tail folded. */
export function paramGroupsHtml(groups: ParamGroup[]): string {
	const inner = groups
		.map((g) => {
			const folded = g.folded.length
				? `<details><summary><span><b>${g.folded.length} more options</b></span></summary>${paramTable(g.folded)}</details>`
				: "";
			return `<div class="sdkr-group"><p class="sdkr-lbl">${esc(g.title)}</p>${paramTable(g.shown)}${folded}</div>`;
		})
		.join("");
	return `<div class="sdkr-params-wrap">${inner}</div>`;
}

export function fieldListHtml(fields: Field[]): string {
	const rows = fields
		.map(
			(f) =>
				`<div><dt><code>${esc(f.name)}</code></dt><dd>${f.description ? inlineHtml(f.description) : `<span class="sdkr-faint">${esc(shortType(f.type, 80))}</span>`}</dd></div>`,
		)
		.join("");
	return `<dl class="sdkr-kv">${rows}</dl>`;
}

function disclosureHtml(label: string, code: string, fields: Field[]): string {
	return `<details><summary><span>${esc(label)} <b>${esc(code)}</b></span></summary>${fieldListHtml(fields)}</details>`;
}

/** Callback contexts and what the method returns, each folded over its field table. */
export function disclosuresHtml(
	callbacks: Callback[],
	returns: { type: string; fields: Field[] } | null,
): string {
	const parts = [
		...callbacks.map((c) =>
			disclosureHtml(
				"Callback context",
				`${c.param}: ${shortType(c.type, 48)}`,
				c.fields,
			),
		),
		...(returns?.fields.length
			? [disclosureHtml("Returns", shortType(returns.type, 56), returns.fields)]
			: []),
	];
	return parts.length
		? `<div class="sdkr-disclosures">${parts.join("")}</div>`
		: "";
}

function glanceRow(m: Method): string {
	const first = m.overloads[0];
	const args = (first?.params ?? []).map((p) => p.name).join(", ");
	return `<tr data-q="${escAttr(`${m.path} ${m.summary}`.toLowerCase())}"><td class="mn"><a href="#${methodAnchor(m.id)}">${esc(m.path.startsWith("new ") ? m.path : m.id)}(${esc(args)})</a></td><td class="ret">${first ? esc(glanceReturn(first.returns.type)) : ""}</td><td class="use">${inlineHtml(m.summary)}</td></tr>`;
}

/** The at-a-glance table: method, what it returns, what it is for. */
export function glanceHtml(methods: Method[]): string {
	return `<table class="sdkr-t sdkr-glance"><tbody>${methods.map(glanceRow).join("")}</tbody></table>`;
}

/**
 * The at-a-glance table of a package page: one table, so its columns line up,
 * with a label row where each group starts. A group with no function has no
 * label; the filter hides a label whose rows it has all hidden.
 */
export function glanceGroupsHtml(
	groups: { title: string; methods: Method[] }[],
): string {
	const rows = groups
		.filter((g) => g.methods.length)
		.map(
			(g) =>
				`<tr class="sdkr-grow" data-group><td colspan="3">${esc(g.title)}</td></tr>${g.methods.map(glanceRow).join("")}`,
		)
		.join("");
	return `<table class="sdkr-t sdkr-glance sdkr-glance-pkg"><tbody>${rows}</tbody></table>`;
}

/** Exported values that are not callable: name, then what they are. */
export function constantListHtml(constants: Constant[]): string {
	return constants
		.map((c) => {
			const lead = c.summary
				? inlineHtml(c.summary)
				: `<span class="sdkr-faint">${esc(shortType(c.type, 80))}</span>`;
			const value = c.summary
				? ` <code class="sdkr-def">${esc(shortType(c.type, 80))}</code>`
				: "";
			return `<div id="${constantAnchor(c.name)}" class="sdkr-tr"><code>${esc(c.name)}</code><div>${lead}${value}</div></div>`;
		})
		.join("");
}

/** A type with no summary shows the names of its first fields instead. */
const FIELDS_SHOWN = 6;

/** "Types on this page": name and one line each; a deprecated alias is struck through with its replacement. */
export function typeListHtml(types: TypeDoc[]): string {
	return types
		.map((t) => {
			const names = (t.fields ?? []).map((f) => f.name);
			const lead = t.summary
				? inlineHtml(t.summary)
				: t.definition
					? `<code class="sdkr-def">${esc(shortType(t.definition, 110))}</code>`
					: names.length
						? `<code class="sdkr-def">${esc(`${names.slice(0, FIELDS_SHOWN).join(", ")}${names.length > FIELDS_SHOWN ? ", …" : ""}`)}</code>`
						: "";
			const dep = t.deprecated
				? ` Deprecated.${t.deprecated.use ? ` Use <a href="#${typeAnchor(t.deprecated.use)}"><code>${esc(t.deprecated.use)}</code></a>.` : ""}`
				: "";
			return `<div id="${typeAnchor(t.name)}" class="sdkr-tr${t.deprecated ? " dep" : ""}"><code>${esc(t.name)}</code><div>${lead}${dep}</div></div>`;
		})
		.join("");
}
