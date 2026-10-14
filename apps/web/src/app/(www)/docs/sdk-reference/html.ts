import { esc, escAttr } from "@/components/code/handlers";
import { type Piece, parseInline } from "./markdown-text";
import {
	type Callback,
	type Field,
	type Method,
	type ParamGroup,
	type ParamRow,
	type TypeDoc,
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

function piecesHtml(pieces: Piece[]): string {
	return pieces
		.map((p) =>
			p.kind === "text"
				? esc(p.text)
				: p.kind === "code"
					? `<code>${esc(p.text)}</code>`
					: `<a href="${escAttr(p.href)}"${/^[/#]/.test(p.href) ? "" : ' target="_blank" rel="noreferrer"'}>${piecesHtml(p.label)}</a>`,
		)
		.join("");
}

/** One line of JSDoc prose (inline code and links) as markup. */
export function inlineHtml(text: string): string {
	return piecesHtml(parseInline(text.replace(/\s*\n\s*/g, " ").trim()));
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

/** The at-a-glance table: method, what it returns, what it is for. */
export function glanceHtml(methods: Method[]): string {
	const rows = methods
		.map((m) => {
			const first = m.overloads[0];
			const args = (first?.params ?? []).map((p) => p.name).join(", ");
			return `<tr data-q="${escAttr(`${m.path} ${m.summary}`.toLowerCase())}"><td class="mn"><a href="#${methodAnchor(m.id)}">${esc(m.id)}(${esc(args)})</a></td><td class="ret">${first ? esc(glanceReturn(first.returns.type)) : ""}</td><td class="use">${inlineHtml(m.summary)}</td></tr>`;
		})
		.join("");
	return `<table class="sdkr-t sdkr-glance"><tbody>${rows}</tbody></table>`;
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
