export interface Action {
	id: string;
	label: string;
	keywords: string[];
	category: string;
	href?: string;
	shortcut?: string[];
}

export const actions: Action[] = [
	// Platform
	{
		id: "home",
		label: "Home",
		keywords: ["dashboard", "overview"],
		category: "Platform",
		href: "/",
	},
	{
		id: "sessions",
		label: "Sessions",
		keywords: ["chat", "agent", "ai"],
		category: "Platform",
		href: "/sessions",
	},
	{
		id: "subgraphs",
		label: "Subgraphs",
		keywords: ["tables", "indexes", "data"],
		category: "Platform",
		href: "/subgraphs",
	},
	// Settings
	{
		id: "api-keys",
		label: "API Keys",
		keywords: ["tokens", "keys", "auth"],
		category: "Settings",
		href: "/api-keys",
	},
	{
		id: "usage",
		label: "Usage",
		keywords: ["quota", "limits", "metrics"],
		category: "Settings",
		href: "/usage",
	},
	{
		id: "settings",
		label: "Settings",
		keywords: ["account", "profile", "project"],
		category: "Settings",
		href: "/settings",
	},
	{
		id: "team",
		label: "Team",
		keywords: ["members", "invite", "collaborators"],
		category: "Settings",
		href: "/team",
	},

	// Account
	{
		id: "logout",
		label: "Log Out",
		keywords: ["sign out", "exit"],
		category: "Account",
	},
];

export function getActionsByCategory(
	filtered: Action[],
): Map<string, Action[]> {
	const map = new Map<string, Action[]>();
	for (const action of filtered) {
		const list = map.get(action.category) || [];
		list.push(action);
		map.set(action.category, list);
	}
	return map;
}
