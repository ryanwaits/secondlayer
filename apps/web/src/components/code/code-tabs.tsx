import { parseFenceOptions } from "@/lib/code/annotations";
import { Children, type ReactNode } from "react";
import { figureOf, frameOf, renderCode } from "./code";
import { type Fence, fenceOf } from "./fence";
import { KEY_CONTROLS, type Variant, esc, escAttr } from "./handlers";

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
 * does the switching. In a `figure` group each pane is its own figure: its
 * margin notes live inside the pane, so they swap with the tab.
 */
export async function CodeTabs({
	sync,
	variant = "docs",
	children,
}: { sync?: string; variant?: Variant; children?: ReactNode }) {
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
				tips: tab.tips,
				variant,
				tabbed: true,
			}),
		),
	);
	// One control for the group: the visible pane's Copy is the one that reads the key.
	const useKey = panes.some((pane) => pane.hasKey) ? KEY_CONTROLS : "";
	// Like a single block: no Copy when no pane can be copied (`nocopy`, output).
	const copy = panes.some((pane) => pane.copyable)
		? '<button type="button" class="copy" data-copy-button>Copy</button>'
		: "";
	const buttons = tabs
		.map(
			(tab, i) =>
				`<button type="button" role="tab" aria-selected="${i === 0}" data-tab="${escAttr(tab.key)}">${esc(tab.label)}</button>`,
		)
		.join("");
	const body = panes
		.map(
			(pane, i) =>
				`<div role="tabpanel" data-tab="${escAttr(tabs[i]?.key ?? "")}"${i ? " hidden" : ""}>${variant === "figure" ? figureOf(pane) : frameOf(pane)}</div>`,
		)
		.join("");
	return (
		<div
			className={`cb cb-tabs${variant === "figure" ? " figure" : ""}`}
			data-sync={sync}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: built here from escaped values and `renderCode` output
			dangerouslySetInnerHTML={{
				__html: `<div class="cb-bar"><span class="tabbar mono" role="tablist">${buttons}</span><span class="r">${useKey}${copy}</span></div>${body}`,
			}}
		/>
	);
}
