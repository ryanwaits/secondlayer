"use client";

import { useEffect } from "react";

/**
 * The only JavaScript code blocks need: one delegated click listener for the
 * whole page, mounted once in the layout. Blocks are server-rendered markup
 * with `data-*` hooks; the Copy text sits in the block's `data-copy`.
 */
export function CodeClient() {
	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;

			const copy = target.closest<HTMLElement>("[data-copy-button]");
			if (copy) {
				const block = copy.closest<HTMLElement>("[data-copy]");
				const text = block?.dataset.copy ?? "";
				const done = () => {
					copy.textContent = "Copied";
					copy.dataset.done = "";
					setTimeout(() => {
						copy.textContent = "Copy";
						delete copy.dataset.done;
					}, 1400);
				};
				const selectAll = () => {
					const body = block?.querySelector(".cb-body");
					if (body) getSelection()?.selectAllChildren(body);
				};
				if (navigator.clipboard)
					navigator.clipboard.writeText(text).then(done, selectAll);
				else selectAll();
				return;
			}

			const fold = target.closest<HTMLElement>("[data-fold]");
			if (fold) {
				fold.setAttribute("aria-expanded", "true");
				fold.hidden = true;
				const rows = fold.nextElementSibling;
				if (rows instanceof HTMLElement) rows.hidden = false;
				return;
			}

			const more = target.closest<HTMLElement>("[data-more]");
			if (more) {
				const rows = more.previousElementSibling;
				if (rows instanceof HTMLElement) rows.hidden = false;
				more.remove();
				return;
			}

			const unfocus = target.closest<HTMLElement>("[data-unfocus]");
			if (unfocus) {
				const off = unfocus.closest(".cb")?.classList.toggle("unfocus");
				unfocus.textContent = off ? "Focus" : "Show all";
			}
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, []);
	return null;
}
