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
		id: "subgraphs",
		label: "Subgraphs",
		keywords: ["tables", "indexes", "data"],
		category: "Platform",
		href: "/subgraphs",
	},
	// Settings
	{
		id: "billing",
		label: "Archive credits",
		keywords: ["credits", "archive", "topup"],
		category: "Settings",
		href: "/billing",
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
