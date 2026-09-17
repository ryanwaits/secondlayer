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
	// Account
	{
		id: "logout",
		label: "Log Out",
		keywords: ["sign out", "exit"],
		category: "Account",
	},
];
