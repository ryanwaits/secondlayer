/** The public origin the docs' markdown twins are served from. */
export const SITE = "https://www.secondlayer.tools";

/** Where a docs route's MDX source lives on GitHub, relative to the app's (www) group. */
export function githubSourcePath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return `${route.slice(1)}/page.mdx`;
}

/** The page's markdown twin. The introduction has no slug of its own. */
export function markdownPath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return route === "/docs" ? "/docs/introduction.md" : `${route}.md`;
}
