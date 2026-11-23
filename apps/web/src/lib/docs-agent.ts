export const SITE = "https://www.secondlayer.tools";

export function githubSourcePath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return `${route.slice(1)}/page.mdx`;
}

export function markdownPath(pathname: string): string {
	const route = pathname.replace(/\/$/, "");
	return route === "/docs" ? "/docs/introduction.md" : `${route}.md`;
}
