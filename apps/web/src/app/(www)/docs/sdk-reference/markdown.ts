import { stripAnnotations } from "@/lib/code/annotations";
import {
	PACKAGE_PAGES,
	type PackageKey,
	SDK_BASE,
	SDK_SURFACES,
	findPackagePage,
	findSurface,
} from "./pages";
import {
	type Field,
	type Method,
	type TypeDoc,
	constructorEntry,
	manifest,
	packageTypes,
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
		...[constructorEntry(data), ...data.methods]
			.filter((m) => m !== null)
			.map((m) => methodMarkdown(m, types)),
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

/** A function-first package: each group is a `##` section of entries, then one list of types. */
function packageMarkdown(key: PackageKey): string {
	const info = findPackagePage(key);
	const groups = manifest(key).surfaces.map((s) => ({
		title: s.title,
		data: surface(s.slug, key),
		slug: s.slug,
	}));
	const types = new Map(
		packageTypes(groups.map((g) => g.data)).map((t) => [t.name, t]),
	);
	const out: string[] = [];
	for (const g of groups) {
		out.push(`## ${g.title}`);
		const blurb = info.groups[g.slug];
		if (blurb) out.push(blurb);
		out.push(`Import from \`${g.data.from ?? info.specifier}\`.`);
		for (const method of g.data.methods)
			out.push(methodMarkdown(method, types));
		if (g.data.constants?.length)
			out.push(
				"### Constants",
				g.data.constants
					.map(
						(c) =>
							`- \`${c.name}\`: \`${cell(c.type)}\`${c.summary ? `. ${cell(c.summary)}` : ""}`,
					)
					.join("\n"),
			);
	}
	const all = [...types.values()];
	if (all.length) out.push("## Types", all.map(typeMarkdown).join("\n"));
	return out.join("\n\n");
}

/** The generated body of a reference page (the SDK's or a package's), or null when `href` is not one. */
export function sdkPageMarkdown(href: string): string | null {
	const pkg = PACKAGE_PAGES.find((p) => p.href === href);
	if (pkg) return packageMarkdown(pkg.key);
	if (href === SDK_BASE) return overviewMarkdown();
	const slug = href.slice(`${SDK_BASE}/`.length);
	if (!href.startsWith(`${SDK_BASE}/`)) return null;
	if (slug === "helpers") return helpersMarkdown();
	if (slug === "errors") return errorsMarkdown();
	return findSurface(slug) ? surfaceMarkdown(slug) : null;
}
