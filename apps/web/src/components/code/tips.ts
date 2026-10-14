/**
 * Tips in code blocks: a tooltip on hover or focus, a popover on click.
 * Loaded on demand by `CodeClient`, only on a page that has a `.tip`; nothing
 * here is in a page's first load. A tip is a `span.tip` whose `data-tip` holds
 * its payload as JSON (see `wrap` in handlers.tsx). One floating element exists
 * per page, built with `textContent`, never `innerHTML`: the payload is data.
 *
 * The tooltip says what a name is. When there is more (a method's signature, a
 * type's fields) it says "Click for details", and a click pins the popover.
 * A tip never navigates. On the reference page the tip belongs to, hovering it
 * lights that entry's row, the way a parameter row lights its token.
 */

type TipData = {
	summary: string;
	kind?: "method" | "type" | "endpoint";
	sig?: string;
	fields?: { name: string; type: string }[];
	more?: number;
	route?: string;
	anchor?: string;
};

const DELAY = 120;
const GAP = 6;
const MARGIN = 8;

let installed = false;
let box: HTMLElement | null = null;
/** The tip the floating element belongs to, and whether a click pinned it open. */
let current: { tip: HTMLElement; pinned: boolean } | null = null;
let lit: Element | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let serial = 0;

const touchOnly = () => matchMedia("(hover: none)").matches;

function dataOf(tip: Element): TipData | null {
	try {
		const data = JSON.parse(tip.getAttribute("data-tip") ?? "") as TipData;
		return typeof data.summary === "string" ? data : null;
	} catch {
		return null;
	}
}

const hasDetails = (data: TipData) => Boolean(data.sig || data.fields?.length);

function el(tag: string, className?: string, text?: string): HTMLElement {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** The popover's body: the signature, or the type's fields. */
function details(data: TipData): HTMLElement[] {
	const out: HTMLElement[] = [];
	if (data.sig) out.push(el("code", "tip-sig", data.sig));
	if (data.fields?.length) {
		const list = el("dl", "tip-fields");
		for (const field of data.fields) {
			list.append(
				el("dt", undefined, field.name),
				el("dd", undefined, field.type),
			);
		}
		out.push(list);
		if (data.more) out.push(el("p", "tip-more", `+${data.more} more`));
	}
	return out;
}

/** Below the token when there is room, above when there is not; kept inside the viewport. */
function place() {
	if (!box || !current) return;
	const anchor = current.tip.getBoundingClientRect();
	const { width, height } = box.getBoundingClientRect();
	const below = anchor.bottom + GAP;
	const top =
		below + height + MARGIN <= innerHeight || anchor.top - GAP - height < MARGIN
			? below
			: anchor.top - GAP - height;
	const left = Math.min(
		Math.max(MARGIN, anchor.left),
		Math.max(MARGIN, innerWidth - width - MARGIN),
	);
	box.style.top = `${Math.max(MARGIN, top)}px`;
	box.style.left = `${left}px`;
}

/** Light the reference row a tip belongs to, when the reader is already on that page. */
function lightRow(data: TipData, on: boolean) {
	if (lit) {
		lit.classList.remove("lit");
		lit = null;
	}
	if (!on || !data.anchor || data.route !== location.pathname) return;
	const row = document.getElementById(data.anchor);
	if (row) {
		row.classList.add("lit");
		lit = row;
	}
}

function close() {
	clearTimeout(timer);
	if (current) {
		current.tip.removeAttribute("aria-describedby");
		const data = dataOf(current.tip);
		if (data) lightRow(data, false);
	}
	box?.remove();
	box = null;
	current = null;
}

function show(tip: HTMLElement, pinned: boolean) {
	const data = dataOf(tip);
	if (!data) return;
	if (current?.tip === tip && current.pinned === pinned) return;
	close();
	const more = hasDetails(data);
	const id = `tip-${++serial}`;
	box = el("div", `tip-box${pinned ? " tip-pop" : ""}`);
	box.id = id;
	if (pinned) {
		box.setAttribute("role", "dialog");
		box.setAttribute("aria-label", tip.textContent ?? "");
		box.append(el("p", "tip-sum", data.summary), ...details(data));
	} else {
		box.setAttribute("role", "tooltip");
		box.append(el("p", "tip-sum", data.summary));
		if (more)
			box.append(
				el(
					"p",
					"tip-hint",
					touchOnly() ? "Tap for details" : "Click for details",
				),
			);
		tip.setAttribute("aria-describedby", id);
	}
	box.style.visibility = "hidden";
	document.body.append(box);
	current = { tip, pinned };
	place();
	box.style.visibility = "";
	lightRow(data, true);
}

function showSoon(tip: HTMLElement) {
	clearTimeout(timer);
	if (current?.pinned) return;
	timer = setTimeout(() => {
		if (!current?.pinned) show(tip, false);
	}, DELAY);
}

function hideSoon(tip: HTMLElement) {
	clearTimeout(timer);
	if (current?.tip === tip && !current.pinned) close();
}

const tipOf = (target: EventTarget | null) =>
	target instanceof Element ? target.closest<HTMLElement>(".tip") : null;

/**
 * Open the popover on a tip with details; a second go closes it. A tip with
 * only a summary has nothing to open: a pointer already shows its tooltip, and
 * a tap (no hover) toggles it.
 */
function toggle(tip: HTMLElement) {
	const data = dataOf(tip);
	if (!data) return;
	if (!hasDetails(data) && !touchOnly()) return;
	if (current?.tip === tip && (current.pinned || !hasDetails(data))) {
		close();
		return;
	}
	show(tip, hasDetails(data));
}

/** Install the page's tip listeners. Safe to call again: they are delegated and live for the page. */
export function activate() {
	if (installed) return;
	installed = true;

	document.addEventListener("mouseover", (event) => {
		const tip = tipOf(event.target);
		if (!tip || touchOnly()) return;
		const from = (event as MouseEvent).relatedTarget;
		if (from instanceof Node && tip.contains(from)) return;
		showSoon(tip);
	});
	document.addEventListener("mouseout", (event) => {
		const tip = tipOf(event.target);
		if (!tip || touchOnly()) return;
		const to = (event as MouseEvent).relatedTarget;
		if (to instanceof Node && tip.contains(to)) return;
		hideSoon(tip);
	});
	document.addEventListener("focusin", (event) => {
		const tip = tipOf(event.target);
		if (tip) showSoon(tip);
	});
	document.addEventListener("focusout", (event) => {
		const tip = tipOf(event.target);
		if (tip) hideSoon(tip);
	});
	document.addEventListener("click", (event) => {
		const tip = tipOf(event.target);
		if (tip) {
			toggle(tip);
			return;
		}
		// Outside the popover: close it. Inside it, the reader is selecting text.
		if (
			current?.pinned &&
			!(event.target instanceof Node && box?.contains(event.target))
		)
			close();
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			close();
			return;
		}
		const tip = tipOf(event.target);
		if (tip && (event.key === "Enter" || event.key === " ")) {
			event.preventDefault();
			toggle(tip);
		}
	});
	window.addEventListener("resize", place);
	// A tooltip is only for a moment; a pinned popover follows its token.
	document.addEventListener(
		"scroll",
		() => {
			if (current?.pinned) place();
			else close();
		},
		{ capture: true, passive: true },
	);
}

/** Close whatever is open: a soft navigation replaces the tips under it. */
export function dismiss() {
	close();
}
