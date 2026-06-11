import { DOCS_NAV } from "@/app/(www)/docs/nav";
import { actions } from "@/lib/actions/registry";

/**
 * Unified result model for the command center. Every item OPENS a page —
 * there are no verbs, no writes, no drill-downs (see
 * docs/specs/command-center.spec.md §2).
 */

export type CommandGroup =
	| "navigation"
	| "your subgraphs"
	| "subscriptions"
	| "public subgraphs"
	| "docs";

/** Fixed render order; empty groups collapse. */
export const GROUP_ORDER: CommandGroup[] = [
	"navigation",
	"your subgraphs",
	"subscriptions",
	"public subgraphs",
	"docs",
];

export const GROUP_CAP = 5;

export interface CommandItem {
	id: string;
	group: CommandGroup;
	label: string;
	/** Mono context line: status · rows, table target, docs section. */
	sub?: string;
	badge?: { text: string; tone: "live" | "warn" | "muted" };
	href?: string;
	newTab?: boolean;
	keywords?: string[];
	/** Registry actions with side effects (logout) instead of an href. */
	actionId?: string;
}

export const NAV_ITEMS: CommandItem[] = actions.map((a) => ({
	id: `nav:${a.id}`,
	group: "navigation",
	label: a.label,
	href: a.href,
	keywords: [...a.keywords, a.category.toLowerCase()],
	actionId: a.id,
}));

/** Vocabulary users reach for that page titles don't carry. */
const DOCS_KEYWORDS: Record<string, string[]> = {
	"/docs/subscriptions": ["webhook", "webhooks", "push"],
	"/docs/index": ["events", "transfers", "decoded"],
	"/docs/streams": ["firehose", "dumps", "raw"],
	"/docs/subgraphs": ["indexer", "deploy", "tables"],
};

export const DOCS_ITEMS: CommandItem[] = DOCS_NAV.flatMap((group) =>
	group.items.map((item) => ({
		id: `docs:${item.href}`,
		group: "docs" as const,
		label: item.title,
		sub: group.label.toLowerCase(),
		href: item.href,
		newTab: true,
		keywords: [
			"docs",
			group.label.toLowerCase(),
			...(DOCS_KEYWORDS[item.href] ?? []),
		],
	})),
);

/** Fallback row when nothing matches — discovery never dead-ends. */
export const DOCS_FALLBACK: CommandItem = {
	id: "docs:fallback",
	group: "docs",
	label: "Open docs",
	sub: "nothing matched",
	href: "/docs",
	newTab: true,
};

const STATUS_TONE: Record<string, "live" | "warn" | "muted"> = {
	active: "live",
	live: "live",
	synced: "live",
	syncing: "warn",
	reindexing: "warn",
	backfilling: "warn",
	paused: "warn",
	stalled: "warn",
	failed: "warn",
	error: "warn",
};

export function badgeFor(
	status: string | undefined,
): CommandItem["badge"] | undefined {
	if (!status) return undefined;
	return { text: status, tone: STATUS_TONE[status] ?? "muted" };
}

export function formatRows(n: number | undefined): string | undefined {
	if (n == null) return undefined;
	return `${n.toLocaleString("en-US")} rows`;
}
