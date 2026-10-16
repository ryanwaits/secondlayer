/**
 * Remark plugin: which prose links in a guide leave the sentence you were
 * reading. Each link carries `data-link` where the docs trail reads it:
 * `jump` scrolls this page (`#x`, or this page's own `/docs/<page>#x`), `peek`
 * goes to another docs page. A peek also carries `data-peek-kind`: `api` for
 * `/docs/api/*`, `section` when it names a heading, `page` otherwise. Anything
 * else (external, `hover:`, `focus:`, `tip`) stays untagged, and so does a link
 * inside a heading, which is navigation rather than prose.
 *
 * Only guides, by the same rule as the code tips. Registered by absolute path
 * in next.config.ts because Turbopack cannot serialize functions.
 */
import { isGuide, routeOf } from "./remark-code-tips.mjs";

/** How one href relates to the page it sits on; null when it is not a docs link. */
export function classifyLink(href, route) {
	if (href.startsWith("#")) return href.length > 1 ? { link: "jump" } : null;
	if (!href.startsWith("/docs/")) return null;
	const [path, hash] = href.split("#");
	const target = path.split("?")[0].replace(/\/$/, "");
	if (target === route && hash) return { link: "jump" };
	const kind = target.startsWith("/docs/api/")
		? "api"
		: hash
			? "section"
			: "page";
	return { link: "peek", kind };
}

export default function remarkDocsLinks() {
	return (tree, file) => {
		const route = routeOf(file?.path);
		if (!isGuide(route)) return;

		const walk = (node) => {
			if (node.type === "heading") return;
			if (node.type === "link") {
				const found = classifyLink(node.url ?? "", route);
				if (found) {
					node.data ??= {};
					node.data.hProperties = {
						...node.data.hProperties,
						"data-link": found.link,
						...(found.kind ? { "data-peek-kind": found.kind } : {}),
					};
				}
			}
			for (const child of node.children ?? []) walk(child);
		};
		walk(tree);
	};
}
