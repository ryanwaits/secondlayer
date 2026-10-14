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
	{ id: "callout", group: "Content", title: "Callout" },
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
