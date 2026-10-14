/**
 * The scope script. Prose reaches code through names (`!ref`, `!pick`) and this
 * resolves them in the DOM, within one scope: a docs `##` section, a whole
 * writing post, or a `<CodeSteps>` block. Blocks stay server components; they
 * only carry `data-ref`, `data-refs` and `data-pick` hooks.
 */

/** The elements one name resolves among: a section's siblings, or one container. */
type Scope = Element[];

const SECTION_START = ".section-heading-wrap";

function scopeOf(el: Element): Scope {
	const steps = el.closest("[data-steps]");
	if (steps) return [steps];
	const article = el.closest(".docs-article, .writing-article");
	if (!article) return [document.body];
	// A post is one scope.
	if (article.classList.contains("writing-article")) return [article];
	// A docs `##` section: the siblings from its heading to the next one.
	let top: Element = el;
	while (top.parentElement && top.parentElement !== article)
		top = top.parentElement;
	let start: Element = top;
	while (!start.matches(SECTION_START) && start.previousElementSibling)
		start = start.previousElementSibling;
	const out: Element[] = [];
	for (let n: Element | null = start; n; n = n.nextElementSibling) {
		if (n !== start && n.matches(SECTION_START)) break;
		out.push(n);
	}
	return out;
}

const find = (scope: Scope, selector: string): HTMLElement[] =>
	scope.flatMap((root) => [
		...(root.matches(selector) ? [root as HTMLElement] : []),
		...root.querySelectorAll<HTMLElement>(selector),
	]);

const hasName = (el: Element, attr: string, name: string) =>
	(el.getAttribute(attr) ?? "").split(" ").includes(name);

/** Light every token, row and mention that answers to `name`. */
function light(scope: Scope, name: string, on: boolean) {
	for (const el of find(scope, ".ref"))
		if (hasName(el, "data-ref", name)) el.classList.toggle("lit", on);
	for (const el of find(scope, ".row[data-refs]"))
		if (hasName(el, "data-refs", name)) el.classList.toggle("lit", on);
	for (const el of find(scope, ".mention"))
		if (el.dataset.hover === name) el.classList.toggle("lit", on);
}

const holds = (row: Element, name: string) =>
	hasName(row, "data-refs", name) ||
	[...row.querySelectorAll(".ref")].some((e) => hasName(e, "data-ref", name));

/** Dim the rows that do not hold `name`, in each block that has any; null clears. */
function focusRef(scope: Scope, name: string | null) {
	for (const cb of find(scope, ".cb")) {
		const rows = [...cb.querySelectorAll<HTMLElement>(".row")];
		const hit = rows.map((row) => name !== null && holds(row, name));
		const any = hit.some(Boolean);
		rows.forEach((row, i) => {
			row.classList.toggle("rdim", any && !hit[i]);
		});
	}
}

let mounted = false;

/** Install the page's delegated listeners once; later calls are no-ops. */
export function mountScope() {
	if (mounted) return;
	mounted = true;
}

export { find, focusRef, hasName, light, scopeOf };
export type { Scope };
