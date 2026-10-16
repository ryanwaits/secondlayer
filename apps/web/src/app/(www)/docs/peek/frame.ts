/**
 * The frame a peek opens in: a hairline box under the link's block with a bar
 * (the crumb, Save, Open page, close), the borrowed nodes, and a clamp with a
 * "Show all" when they run long. Plain DOM, built with `textContent`; the
 * trail drives it and owns what the buttons do (they carry `data-peek`). The
 * frame is its own scope (`data-scope`), so names in the borrowed prose and
 * code resolve inside it and not against the page it sits on.
 */

import type { PeekKind } from "../trail-store";

/** The body's height while clamped: about ten lines. */
const CLAMP = 248;
/** A body this close to the clamp is shown whole rather than cut for a few lines. */
const SLACK = 40;

export type Frame = {
	el: HTMLElement;
	/** The borrowed nodes arrived: name the frame, fill the body, clamp if long. */
	fill(parts: {
		title: string;
		pageTitle: string;
		nodes: Element[];
	}): void;
	markSaved(saved: boolean): void;
	/** Drop the clamp and the button. */
	expand(): void;
	focusSave(): void;
	close(): void;
};

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? "" : "s"}`;

/** "1 example, 2 tables, 1 list": what a clamped body still holds. Empty when none. */
export function countsLabel(counts: {
	examples: number;
	tables: number;
	lists: number;
}): string {
	return [
		counts.examples ? plural(counts.examples, "example") : "",
		counts.tables ? plural(counts.tables, "table") : "",
		counts.lists ? plural(counts.lists, "list") : "",
	]
		.filter(Boolean)
		.join(", ");
}

/** Count the code blocks, tables and lists in a body; nested ones count with their outer. */
function countsOf(body: Element) {
	return {
		examples: [...body.querySelectorAll(".cb")].filter(
			(block) => !block.parentElement?.closest(".cb"),
		).length,
		tables: body.querySelectorAll("table").length,
		lists: [...body.querySelectorAll("ul, ol")].filter(
			(list) => !list.parentElement?.closest("ul, ol"),
		).length,
	};
}

function button(action: string, text: string, className = ""): HTMLElement {
	const el = document.createElement("button");
	el.type = "button";
	el.dataset.peek = action;
	if (className) el.className = className;
	el.textContent = text;
	return el;
}

/**
 * Open a frame right after `block` (the article's direct child that holds the
 * link), so the text above it never moves. The body is empty until `fill`.
 */
export function openFrame(
	block: Element,
	{ kind, saved }: { kind: PeekKind; saved: boolean },
): Frame {
	const el = document.createElement("div");
	el.className = "docs-peek";
	el.setAttribute("role", "region");
	el.setAttribute("data-scope", "");

	const crumb = document.createElement("span");
	crumb.className = "docs-peek-crumb";
	const save = button("save", saved ? "Saved" : "Save");
	if (saved) save.dataset.saved = "";
	const bar = document.createElement("div");
	bar.className = "docs-peek-bar";
	const close = button("close", "×");
	close.setAttribute("aria-label", "Close");
	bar.append(
		crumb,
		save,
		button("open", "Open page →", "docs-peek-open"),
		close,
	);

	const body = document.createElement("div");
	body.className = "docs-peek-body is-clamped";
	body.setAttribute("aria-busy", "true");
	const more = button("more", "", "docs-peek-more");
	more.hidden = true;
	el.append(bar, body, more);
	block.after(el);

	const expand = () => {
		body.classList.remove("is-clamped");
		more.hidden = true;
	};

	return {
		el,
		fill({ title, pageTitle, nodes }) {
			// A page peek is the page itself: one name, no "page / section".
			const whole = kind === "page";
			el.setAttribute(
				"aria-label",
				whole ? pageTitle : `${title}, from ${pageTitle}`,
			);
			const name = document.createElement("b");
			name.textContent = title;
			if (whole) crumb.replaceChildren(name);
			else {
				const from = document.createElement("span");
				from.textContent = pageTitle;
				crumb.replaceChildren(from, " / ", name);
			}
			body.replaceChildren(...nodes);
			body.removeAttribute("aria-busy");
			// Measured while clamped: scrollHeight is the whole body either way.
			if (body.scrollHeight <= CLAMP + SLACK) return expand();
			const counts = countsLabel(countsOf(body));
			more.replaceChildren(`Show all of ${title}`);
			if (counts) {
				const tally = document.createElement("span");
				tally.textContent = counts;
				more.append(" ", tally);
			}
			more.hidden = false;
		},
		markSaved(isSaved) {
			save.textContent = isSaved ? "Saved" : "Save";
			if (isSaved) save.dataset.saved = "";
			else delete save.dataset.saved;
		},
		expand,
		focusSave: () => save.focus(),
		close: () => el.remove(),
	};
}
