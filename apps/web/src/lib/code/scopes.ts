import { parseAnnotations, parseFenceOptions } from "./annotations";

/**
 * What prose can point at is resolved within a scope: a docs page's `##`
 * section, or a whole writing post. This reads an MDX file the way the runtime
 * resolves it, so the budget test can check names before a reader finds the
 * link dead.
 */
export type Scope = {
	/** The scope's heading (or "intro" before the first `##`). */
	where: string;
	/** MDX outside fences. */
	prose: string;
	fences: { lang: string; body: string }[];
};

const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;

/** Split MDX into scopes. `whole` keeps the file as one scope (writing posts). */
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

/** Every distinct name a scope's fences declare with one annotation verb. */
export function declared(scope: Scope, verb: "ref" | "pick"): Set<string> {
	const names = new Set<string>();
	for (const f of scope.fences)
		for (const a of parseAnnotations(f.body, f.lang).annotations)
			if (a.name === verb) names.add(a.value.split(":")[0]?.trim() ?? "");
	return names;
}

/** Problems with one MDX file's prose-to-code wiring, as lines for a test to print. */
export function proseProblems(file: string, source: string): string[] {
	const found: string[] = [];
	const whole = file.startsWith("writing/");
	for (const scope of scopesOf(source, whole)) {
		const where = `${file} "${scope.where}"`;
		const refs = declared(scope, "ref");
		for (const m of scope.prose.matchAll(/\]\((hover|focus):([^)]*)\)/g))
			if (!refs.has(m[2] ?? ""))
				found.push(
					`${where}: ${m[1]}:${m[2]} has no !ref ${m[2]} in the section`,
				);
		const picks = declared(scope, "pick");
		for (const m of scope.prose.matchAll(/<Pick\s+name="([^"]*)"/g))
			if (!picks.has(m[1] ?? ""))
				found.push(`${where}: <Pick name="${m[1]}"> has no !pick ${m[1]}`);
		if (picks.size > 1)
			found.push(
				`${where}: ${picks.size} pick names (${[...picks].join(", ")}), max 1 per section`,
			);
	}
	return found;
}
