import { SITE } from "@/lib/docs-agent";
import { type Insight, causeText, insightHref } from "@/lib/insights";

export type ShareTarget = "claude" | "chatgpt" | "cursor";

/** Where each target opens with the text filled in. Claude and ChatGPT's
 *  `q` is widely used but undocumented; Cursor's is documented. Keep every
 *  URL here so a broken one is a one-line fix. */
export const SHARE_TARGETS: Record<
	ShareTarget,
	{ label: string; base: string }
> = {
	claude: { label: "Claude", base: "https://claude.ai/new?q=" },
	chatgpt: { label: "ChatGPT", base: "https://chatgpt.com/?q=" },
	cursor: { label: "Cursor", base: "https://cursor.com/link/prompt?text=" },
};

/** Cursor rejects deep links over 8,000 characters; one cap for all three. */
export const MAX_URL = 8000;

/** The dashboard page for an insight, absolute so it works outside the app. */
export function shareLinkFor(insight: Insight): string {
	return `${SITE}${insightHref(insight)}`;
}

type Parts = { prompt: string; commands: readonly string[] };

/** The one place the shared text is laid out; shortening reuses it. */
function compose(insight: Insight, { prompt, commands }: Parts): string {
	const cause = causeText(insight.how);
	const blocks = [
		[insight.meta, cause ? `Likely cause: ${cause}` : ""],
		[prompt],
		commands.map((command) => `Check: ${command}`),
		[shareLinkFor(insight)],
	];
	return blocks
		.map((lines) => lines.filter(Boolean).join("\n"))
		.filter(Boolean)
		.join("\n\n");
}

export function buildShareText(insight: Insight): {
	title: string;
	text: string;
	url: string;
} {
	return {
		title: insight.lead,
		text: compose(insight, insight.handoff),
		url: shareLinkFor(insight),
	};
}

/** The target's deep link. Over the cap, only the prompt shrinks; the dashboard link always survives. */
export function shareUrl(target: ShareTarget, insight: Insight): string {
	const { base } = SHARE_TARGETS[target];
	const build = (parts: Parts) =>
		base + encodeURIComponent(compose(insight, parts));
	const { prompt, commands } = insight.handoff;
	const full = build({ prompt, commands });
	if (full.length <= MAX_URL) return full;

	// Never cut between a surrogate pair: encodeURIComponent throws on a lone half.
	const cut = (n: number) => {
		const head = prompt.slice(0, n);
		return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head;
	};
	const withPrompt = (n: number) => build({ prompt: `${cut(n)}…`, commands });
	if (withPrompt(0).length > MAX_URL) {
		return build({ prompt: "", commands: [] });
	}
	let low = 0;
	let high = prompt.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (withPrompt(mid).length <= MAX_URL) low = mid;
		else high = mid - 1;
	}
	return withPrompt(low);
}
