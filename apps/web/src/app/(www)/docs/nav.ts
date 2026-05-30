export interface DocsNavItem {
	title: string;
	href: string;
}
export interface DocsNavGroup {
	label: string;
	items: DocsNavItem[];
}

/** Sidebar information architecture for the docs site. */
export const DOCS_NAV: DocsNavGroup[] = [
	{
		label: "Getting started",
		items: [
			{ title: "Introduction", href: "/docs" },
			{ title: "Quickstart", href: "/docs/quickstart" },
			{ title: "Authentication", href: "/docs/authentication" },
		],
	},
	{
		label: "Core surfaces",
		items: [
			{ title: "Datasets", href: "/docs/datasets" },
			{ title: "Index", href: "/docs/index" },
			{ title: "Subgraphs", href: "/docs/subgraphs" },
			{ title: "Subscriptions", href: "/docs/subscriptions" },
			{ title: "Streams", href: "/docs/streams" },
		],
	},
	{
		label: "Reference",
		items: [
			{ title: "REST API", href: "/docs/rest-api" },
			{ title: "Contract discovery", href: "/docs/contracts" },
			{ title: "SDK", href: "/docs/sdk" },
			{ title: "CLI", href: "/docs/cli" },
			{ title: "Changelog", href: "/docs/changelog" },
		],
	},
];
