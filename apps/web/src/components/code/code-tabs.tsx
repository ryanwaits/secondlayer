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
	const useKey = panes.some((pane) => pane.hasKey) ? KEY_CONTROLS : "";
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
