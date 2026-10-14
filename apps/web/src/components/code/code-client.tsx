"use client";

import { useAuth } from "@/lib/auth";
import { DOCS_KEY_FORGET, DOCS_KEY_STORE } from "@/lib/code/docs-key-store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/** Show one pane of a tab group; a group without that tab stays as it is. */
function selectTab(group: HTMLElement, key: string) {
	const tabs = group.querySelectorAll<HTMLElement>("button[data-tab]");
	if (![...tabs].some((t) => t.dataset.tab === key)) return;
	for (const t of tabs)
		t.setAttribute("aria-selected", String(t.dataset.tab === key));
	for (const pane of group.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
		pane.hidden = pane.dataset.tab !== key;
}

/**
 * The only JavaScript code blocks need: one delegated click listener for the
 * whole page, mounted once in the layout. Blocks are server-rendered markup
 * with `data-*` hooks; Copy reads the block's own rows.
 */
export function CodeClient() {
	const router = useRouter();
	const pathname = usePathname();
	const { account, loading } = useAuth();

	// "Use my key": the key module loads only for a signed-in reader on a page
	// that has a sample to fill. Signed out, any key this tab held is dropped.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` re-runs the scan for the samples a soft navigation brings in
	useEffect(() => {
		if (loading) return;
		if (!account) {
			try {
				sessionStorage.removeItem(DOCS_KEY_STORE);
			} catch {
				// Storage is optional.
			}
			window.dispatchEvent(new Event(DOCS_KEY_FORGET));
			return;
		}
		const load = () => import("./use-key").then((m) => m.activate(account.id));
		if (document.querySelector("[data-use-key]")) {
			load();
			return;
		}
		// A sample that mounts later (the API drawer) loads it when it arrives.
		const arrivals = new MutationObserver((records) => {
			for (const record of records)
				for (const node of record.addedNodes)
					if (
						node instanceof Element &&
						(node.matches("[data-use-key]") ||
							node.querySelector("[data-use-key]"))
					) {
						arrivals.disconnect();
						load();
						return;
					}
		});
		arrivals.observe(document.body, { childList: true, subtree: true });
		return () => arrivals.disconnect();
	}, [account, loading, pathname]);

	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;

			const copy = target.closest<HTMLElement>("[data-copy-button]");
			if (copy) {
				// A tab group's Copy takes the visible pane; a block's own Copy its block.
				const tabs = copy.closest(".cb-tabs");
				const block = tabs
					? tabs.querySelector<HTMLElement>(
							'[role="tabpanel"]:not([hidden]) [data-copyable]',
						)
					: copy.closest<HTMLElement>("[data-copyable]");
				// Copy is what the rows say, so the Base URL switch's current value
				// comes along and removed diff lines do not.
				const text = [
					...(block?.querySelectorAll(".cb-body .row:not(.del)") ?? []),
				]
					.map((row) => {
						const tx = row.querySelector(":scope > .tx");
						const prompt = row.querySelector(":scope > .prompt");
						return tx
							? tx.textContent
							: (row.textContent ?? "").slice(prompt?.textContent?.length ?? 0);
					})
					.join("\n");
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

			if (target.closest("[data-use-key]")) {
				import("./use-key").then((m) => m.useKey());
				return;
			}

			// An internal link in a block is plain markup; the router makes it a soft navigation.
			const link = target.closest<HTMLAnchorElement>("a.lk");
			const to = link?.getAttribute("href");
			if (
				to?.startsWith("/") &&
				!event.defaultPrevented &&
				event.button === 0 &&
				!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
			) {
				event.preventDefault();
				router.push(to);
				return;
			}

			const tab = target.closest<HTMLElement>("button[data-tab]");
			const group = tab?.closest<HTMLElement>(".cb-tabs");
			if (tab && group) {
				// Every group on the page with this sync key follows, where it has the tab.
				const sync = group.dataset.sync;
				const groups = sync
					? document.querySelectorAll<HTMLElement>(
							`.cb-tabs[data-sync="${CSS.escape(sync)}"]`,
						)
					: [group];
				for (const g of groups) selectTab(g, tab.dataset.tab ?? "");
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
	}, [router]);
	return null;
}
