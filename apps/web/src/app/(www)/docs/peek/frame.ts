import type { PeekKind } from "../trail-store";

const CLAMP = 248;
const SLACK = 40;

export type Frame = {
	el: HTMLElement;
	fill(parts: {
		title: string;
		pageTitle: string;
		nodes: Element[];
	}): void;
	markSaved(saved: boolean): void;
	expand(): void;
	focusSave(): void;
	close(): void;
};

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? "" : "s"}`;

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
	const save = button("save", saved ? "Pinned" : "Pin");
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
			save.textContent = isSaved ? "Pinned" : "Pin";
			if (isSaved) save.dataset.saved = "";
			else delete save.dataset.saved;
		},
		expand,
		focusSave: () => save.focus(),
		close: () => el.remove(),
	};
}
