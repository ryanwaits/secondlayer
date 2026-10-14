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

const touchOnly = () => matchMedia("(hover: none)").matches;

/** Mentions light on hover and keyboard focus; the pointer moving between a mention's own children does not count. */
function onMention(event: Event, on: boolean) {
	const from = event.target instanceof Element ? event.target : null;
	const mention = from?.closest<HTMLElement>(".mention");
	const to = (event as MouseEvent).relatedTarget;
	// On touch the emulated hover and the focus a tap gives would fight the toggle below.
	if (!mention || touchOnly() || (to instanceof Node && mention.contains(to)))
		return;
	light(scopeOf(mention), mention.dataset.hover ?? "", on);
}

function onClick(event: MouseEvent) {
	if (!(event.target instanceof Element)) return;
	const mention = event.target.closest<HTMLElement>(".mention");
	// A tap has no hover: it toggles.
	if (mention && touchOnly()) {
		light(
			scopeOf(mention),
			mention.dataset.hover ?? "",
			!mention.classList.contains("lit"),
		);
		return;
	}
	const flink = event.target.closest<HTMLElement>(".flink");
	if (flink) {
		const scope = scopeOf(flink);
		const on = flink.getAttribute("aria-pressed") !== "true";
		for (const other of find(scope, ".flink"))
			other.setAttribute("aria-pressed", String(other === flink && on));
		focusRef(scope, on ? (flink.dataset.focus ?? null) : null);
	}
}

let mounted = false;

/** Install the page's delegated listeners once; later calls are no-ops. */
export function mountScope() {
	if (mounted) return;
	mounted = true;
	document.addEventListener("mouseover", (e) => onMention(e, true));
	document.addEventListener("mouseout", (e) => onMention(e, false));
	document.addEventListener("focusin", (e) => onMention(e, true));
	document.addEventListener("focusout", (e) => onMention(e, false));
	document.addEventListener("click", onClick);
}

export { find, focusRef, hasName, light, scopeOf };
export type { Scope };
