import { parseAnnotations, parseFenceOptions } from "./annotations";

export type Scope = {
	where: string;
	prose: string;
	fences: { lang: string; body: string }[];
};

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;

export function scopesOf(source: string, whole: boolean): Scope[] {
	const scopes: Scope[] = [{ where: "intro", prose: "", fences: [] }];
	let fence: { mark: string; info: string; body: string[] } | null = null;
	for (const line of source.split("\n")) {
		const current = scopes[scopes.length - 1] as Scope;
		if (fence) {
			if (line.trim() === fence.mark) {
				current.fences.push({
					lang: parseFenceOptions(fence.info).lang,
					body: fence.body.join("\n"),
				});
				fence = null;
			} else fence.body.push(line);
			continue;
		}
		const open = FENCE_OPEN.exec(line);
		if (open) {
			fence = {
				mark: open[1] as string,
				info: (open[2] ?? "").trim(),
				body: [],
			};
			continue;
		}
		const heading = /^##\s+(.+?)\s*#*\s*$/.exec(line);
		if (!whole && heading) {
			scopes.push({ where: heading[1] as string, prose: "", fences: [] });
			continue;
		}
		current.prose += `${line}\n`;
	}
	return scopes;
}

export function declared(scope: Scope, verb: "ref" | "pick"): Set<string> {
	const names = new Set<string>();
	for (const f of scope.fences)
		for (const a of parseAnnotations(f.body, f.lang).annotations)
			if (a.name === verb) names.add(a.value.split(":")[0]?.trim() ?? "");
	return names;
}

function firstOptions(scope: Scope): Map<string, string> {
	const first = new Map<string, string>();
	for (const f of scope.fences)
		for (const a of parseAnnotations(f.body, f.lang).annotations) {
			if (a.name !== "pick") continue;
			const [name, options] = a.value.split(":");
			const option = options?.split("|")[0]?.trim();
			if (name && option) first.set(name.trim(), option);
		}
	return first;
}

export function proseProblems(file: string, source: string): string[] {
	const found: string[] = [];
	const whole = file.startsWith("blog/");
	for (const scope of scopesOf(source, whole)) {
		const where = `${file} "${scope.where}"`;
		const refs = declared(scope, "ref");
		for (const m of scope.prose.matchAll(/\]\((hover|focus):([^)]*)\)/g))
			if (!refs.has(m[2] ?? ""))
				found.push(
					`${where}: ${m[1]}:${m[2]} has no !ref ${m[2]} in the section`,
				);
		if (!whole && /<CodeSteps[\s>]/.test(scope.prose))
			found.push(`${where}: <CodeSteps> is for writing posts only`);
		for (const m of scope.prose.matchAll(/<Step\s+ref="([^"]*)"/g))
			if (!refs.has(m[1] ?? ""))
				found.push(`${where}: <Step ref="${m[1]}"> has no !ref ${m[1]}`);
		const picks = declared(scope, "pick");
		const firsts = firstOptions(scope);
		for (const m of scope.prose.matchAll(/<Pick\b([^>]*?)\/?>/g)) {
			const name = /\bname="([^"]*)"/.exec(m[1] ?? "")?.[1] ?? "";
			const given = /\bdefault="([^"]*)"/.exec(m[1] ?? "")?.[1];
			if (!picks.has(name))
				found.push(`${where}: <Pick name="${name}"> has no !pick ${name}`);
			else if (given !== firsts.get(name))
				found.push(
					`${where}: <Pick name="${name}"> needs default="${firsts.get(name)}" (the first !pick option)`,
				);
		}
		if (picks.size > 1)
			found.push(
				`${where}: ${picks.size} pick names (${[...picks].join(", ")}), max 1 per section`,
			);
	}
	return found;
}
