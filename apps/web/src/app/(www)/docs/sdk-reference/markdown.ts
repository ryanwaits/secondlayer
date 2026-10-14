import { stripAnnotations } from "@/lib/code/annotations";
import { SDK_BASE, SDK_SURFACES, findSurface } from "./pages";
import {
	type Field,
	type Method,
	type TypeDoc,
	manifest,
	paramRows,
	restTarget,
	signatureOf,
	surface,
	typeMap,
} from "./reference";

/**
 * The markdown twins of the SDK reference pages, built from the same data the
 * pages render. Methods are `###` entries under `## Methods`, parameters are a
 * table each, and the types a surface uses follow as a list.
 */

const cell = (text: string) =>
	text
		.replace(/\s*\n\s*/g, " ")
		.replace(/\|/g, "\\|")
		.trim();

function paramsTable(method: Method, types: ReadonlyMap<string, TypeDoc>) {
	const rows = paramRows(method, types);
	if (!rows.length) return "";
	return [
		"| Name | Type | Required | Description |",
		"| --- | --- | --- | --- |",
		...rows.map(
			(r) =>
				`| \`${r.name}\` | \`${cell(r.type)}\` | ${r.required ? "yes" : "no"}${r.only ? ` (${r.only} only)` : ""} | ${cell(r.description)} |`,
		),
	].join("\n");
}

function methodMarkdown(
	method: Method,
	types: ReadonlyMap<string, TypeDoc>,
): string {
	const args = (method.overloads[0]?.params ?? [])
		.map((p) => p.name)
		.join(", ");
	const out = [`### ${method.path}(${args})`];
	const description =
		method.description ||
		method.overloads.find((o) => o.description)?.description;
	if (description) out.push(description);
	if (method.deprecated)
		out.push(
			`Deprecated.${method.deprecated.use ? ` Use \`${method.deprecated.use}\`.` : ""}`,
		);
	if (method.rest) {
		const { method: verb, path } = restTarget(method.rest);
		out.push(`REST twin: \`${verb} ${path}\``);
	}
	for (const overload of method.overloads) {
		const code = stripAnnotations(
			signatureOf(method, overload, new Set()),
			"ts",
		);
		out.push(
			method.overloads.length > 1 && overload.label
				? `**${overload.label}**\n\n\`\`\`ts\n${code}\n\`\`\``
				: `\`\`\`ts\n${code}\n\`\`\``,
		);
	}
	const table = paramsTable(method, types);
	if (table) out.push(table);
	for (const example of method.examples)
		out.push(
			`\`\`\`ts\n${stripAnnotations(example.code.trimEnd(), "ts")}\n\`\`\``,
		);
	return out.join("\n\n");
}

function fieldBullets(fields: Field[]): string {
	return fields
		.map(
			(f) =>
				`  - \`${f.name}\`${f.required ? "" : "?"}: \`${cell(f.type)}\`${f.description ? `. ${cell(f.description)}` : ""}`,
		)
		.join("\n");
}

function typeMarkdown(type: TypeDoc): string {
	const head = `- \`${type.name}\`${type.deprecated ? " (deprecated)" : ""}${type.summary ? `: ${cell(type.summary)}` : ""}${!type.summary && type.definition ? `: \`${cell(type.definition)}\`` : ""}`;
	return type.fields?.length ? `${head}\n${fieldBullets(type.fields)}` : head;
}

function surfaceMarkdown(slug: string): string {
	const data = surface(slug);
	const types = typeMap(data);
	const out = [
		"## Methods",
		...data.methods.map((m) => methodMarkdown(m, types)),
	];
	if (data.types.length)
		out.push("## Types", data.types.map(typeMarkdown).join("\n"));
	return out.join("\n\n");
}

function helpersMarkdown(): string {
	return manifest()
		.helpers.map(
			(h) =>
				`### ${h.name}\n\n${h.summary ? `${h.summary}\n\n` : ""}\`\`\`ts\n${h.signature}\n\`\`\``,
		)
		.join("\n\n");
}

function errorsMarkdown(): string {
	return [
		"| Class | Extends | Status | Meaning |",
		"| --- | --- | --- | --- |",
		...manifest().errors.map(
			(e) =>
				`| \`${e.name}\` | \`${e.parent}\` | ${e.status ?? ""} | ${cell(e.summary)} |`,
		),
	].join("\n");
}

function overviewMarkdown(): string {
	const m = manifest();
	const counts = new Map(m.surfaces.map((s) => [s.slug, s.methodCount]));
	return [
		`\`${m.package}@${m.version}\`, read from source with openpkg.`,
		"## Surfaces",
		SDK_SURFACES.map(
			(s) =>
				`- [${s.title}](${SDK_BASE}/${s.slug}): ${s.blurb} (${counts.get(s.slug) ?? 0} methods)`,
		).join("\n"),
		`## Helpers\n\n${m.helpers.length} functions you import directly: [Helpers](${SDK_BASE}/helpers).`,
		`## Errors\n\n${m.errors.length} error classes: [Errors](${SDK_BASE}/errors).`,
	].join("\n\n");
}

/** The generated body of an SDK reference page, or null when `href` is not one. */
export function sdkPageMarkdown(href: string): string | null {
	if (href === SDK_BASE) return overviewMarkdown();
	const slug = href.slice(`${SDK_BASE}/`.length);
	if (!href.startsWith(`${SDK_BASE}/`)) return null;
	if (slug === "helpers") return helpersMarkdown();
	if (slug === "errors") return errorsMarkdown();
	return findSurface(slug) ? surfaceMarkdown(slug) : null;
}
