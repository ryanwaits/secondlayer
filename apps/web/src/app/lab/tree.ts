/** The story tree: one row per component story, grouped for the left rail. The registry (stories.tsx) adds each story's body. */
export const STORY_INDEX = [
	{ id: "color", group: "Foundations", title: "Color" },
	{ id: "type", group: "Foundations", title: "Type" },
	{ id: "code", group: "Code", title: "Code" },
	{ id: "code-figure", group: "Code", title: "Code figure" },
	{ id: "code-tabs", group: "Code", title: "Code tabs" },
	{ id: "transcript", group: "Code", title: "Transcript" },
	{ id: "choice", group: "Controls", title: "Choice" },
	{ id: "amount-picker", group: "Controls", title: "Amount picker" },
	{ id: "tabs", group: "Controls", title: "Tabs" },
	{ id: "buttons", group: "Controls", title: "Buttons" },
	{ id: "account-menu", group: "Controls", title: "Account menu" },
	{ id: "dashboard-shell", group: "Dashboard", title: "Dashboard shell" },
	{ id: "heartbeat", group: "Dashboard", title: "Chain heartbeat" },
	{ id: "view-command", group: "Dashboard", title: "View command" },
	{ id: "breadcrumb", group: "Dashboard", title: "Breadcrumb" },
	{ id: "resource-row", group: "Dashboard", title: "Resource row" },
	{ id: "webhook-header", group: "Dashboard", title: "Webhook header" },
	{ id: "account-rows", group: "Dashboard", title: "Rows screen" },
	{ id: "account-keys", group: "Dashboard", title: "Keys screen" },
	{ id: "charts-bars", group: "Dashboard", title: "Bars and band" },
	{ id: "charts-heat", group: "Dashboard", title: "Heat strip" },
	{ id: "charts-lines", group: "Dashboard", title: "Context lines" },
	{ id: "charts-spend", group: "Dashboard", title: "Spend" },
	{ id: "charts-small", group: "Dashboard", title: "Small charts" },
	{ id: "insight-card", group: "Dashboard", title: "Insight card" },
	{ id: "insight-stack", group: "Dashboard", title: "Insight stack" },
	{ id: "handoff", group: "Dashboard", title: "Hand off" },
	{ id: "callout", group: "Content", title: "Callout" },
	{ id: "subgraph-grid", group: "Content", title: "Subgraph grid" },
	{ id: "eyebrow-facts", group: "Content", title: "Eyebrow, facts, status" },
] as const;

export type StoryId = (typeof STORY_INDEX)[number]["id"];
export type StoryGroup = (typeof STORY_INDEX)[number]["group"];

export type NavItem = { href: string; label: string; group: string };

/** Everything the rail links to, in order: the stories, then the figure catalog. */
export const NAV_ITEMS: NavItem[] = [
	...STORY_INDEX.map((s) => ({
		href: `/lab/components/${s.id}`,
		label: s.title,
		group: s.group,
	})),
	{ href: "/lab/figures", label: "Figure library", group: "Writing figures" },
];
