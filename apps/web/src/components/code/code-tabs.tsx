import { parseFenceOptions } from "@/lib/code/annotations";
import { Children, type ReactNode } from "react";
import { renderCode } from "./code";
import { type Fence, fenceOf } from "./fence";
import { esc, escAttr } from "./handlers";

const LANG_LABEL: Record<string, string> = {
	bash: "cURL",
	typescript: "TypeScript",
	tsx: "TSX",
	javascript: "JavaScript",
	json: "JSON",
	sql: "SQL",
	toml: "TOML",
	text: "Output",
};

type Tab = Fence & { key: string; label: string };

/** The tab's identity: its title if it has one, else its language. Same key, same tab across groups. */
function tabOf(fence: Fence): Tab {
	const options = parseFenceOptions(`${fence.lang} ${fence.meta ?? ""}`);
	const title = fence.title ?? options.title;
	const lang = options.lang;
	return {
		...fence,
		key: title ?? lang,
		label: title ?? LANG_LABEL[lang] ?? lang,
	};
}

/**
 * Consecutive fences as tabs: the language (or the fence's title) is the label,
 * one Copy in the bar copies the visible pane, and choosing a tab switches
 * every group on the page with the same `sync` key and that tab. Nothing is
 * stored, so a new page starts on its default tab. In MDX, put the fences
 * inside `<CodeTabs sync="lang">` separated by blank lines. Server-rendered
 * markup, one string like a single block; the page's one `CodeClient` listener
 * does the switching.
 */
export async function CodeTabs({
	sync,
	children,
}: { sync?: string; children?: ReactNode }) {
	const tabs = Children.toArray(children).flatMap((child) => {
		const fence = fenceOf(child);
		return fence ? [tabOf(fence)] : [];
	});
	if (!tabs.length) return null;
	const panes = await Promise.all(
		tabs.map((tab) =>
			renderCode({
				code: tab.code,
				lang: tab.lang,
				meta: tab.meta,
				title: tab.title,
				links: tab.links,
				tabbed: true,
			}),
		),
	);
	const buttons = tabs
		.map(
			(tab, i) =>
				`<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${escAttr(tab.key)}">${esc(tab.label)}</button>`,
		)
		.join("");
	const body = panes
		.map(
			(pane, i) =>
				`<div role="tabpanel" data-tab="${escAttr(tabs[i]?.key ?? "")}"${i ? " hidden" : ""}><div class="${pane.className}"${pane.copyable ? " data-copyable" : ""}>${pane.html}</div></div>`,
		)
		.join("");
	return (
		<div
			className="cb cb-tabs"
			data-sync={sync}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: built here from escaped values and `renderCode` output
			dangerouslySetInnerHTML={{
				__html: `<div class="cb-bar"><span class="tabs" role="tablist">${buttons}</span><span class="r"><button type="button" class="copy" data-copy-button>Copy</button></span></div>${body}`,
			}}
		/>
	);
}
