import type { PeekKind } from "../trail-store";
import { type Child, type Range, ledeRange, sectionRange } from "./slice";

export type Target = {
	title: string;
	pageTitle: string;
	nodes: Element[];
};

const documents = new Map<string, Promise<Document | null>>();

/**
 * The page at `path` as a parsed document, or null when it cannot be had. A
 * failure is not cached, so a later click tries again.
 */
export function loadDocument(path: string): Promise<Document | null> {
	let found = documents.get(path);
	if (!found) {
		found = fetch(path, { credentials: "same-origin" })
			.then((res) => (res.ok ? res.text() : null))
			.then((html) =>
				html ? new DOMParser().parseFromString(html, "text/html") : null,
			)
			.catch(() => null);
		documents.set(path, found);
		found.then((doc) => {
			if (!doc) documents.delete(path);
		});
	}
	return found;
}

export function prefetch(href: string) {
	loadDocument(new URL(href, location.origin).pathname);
}

const describe = (el: Element): Child => ({
	tag: el.tagName.toLowerCase(),
	className: el.getAttribute("class") ?? "",
	id: el.querySelector(":scope > h2")?.id || el.id,
});

function clean(root: Element, path: string) {
	root.removeAttribute("id");
	for (const el of root.querySelectorAll("[id]")) el.removeAttribute("id");
	for (const el of root.querySelectorAll("script, .apiref-copy-url"))
		el.remove();
	for (const el of root.querySelectorAll(".apiref-field-link")) el.remove();
	// A heading's text sits inside its permalink, so unwrap rather than remove.
	for (const el of root.querySelectorAll(".heading-anchor"))
		el.replaceWith(...el.childNodes);
	for (const el of root.querySelectorAll("[data-link]")) {
		el.setAttribute("data-link-in-peek", el.getAttribute("data-link") ?? "");
		el.removeAttribute("data-link");
	}
	for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
		a.setAttribute("href", `${path}${a.getAttribute("href")}`);
}

function take(children: Element[], range: Range, path: string): Element[] {
	return children.slice(range.start, range.end).map((child) => {
		const clone = document.importNode(child, true) as Element;
		clean(clone, path);
		return clone;
	});
}

function endpoint(section: Element, path: string): Element | null {
	const route = section.querySelector(".apiref-route");
	const desc = section.querySelector(":scope > .apiref-desc");
	const groups = [
		...section.querySelectorAll(".apiref-main > .apiref-group"),
	].filter(
		(group) =>
			group.querySelector(".apiref-group-title")?.textContent?.trim() !==
			"Returns",
	);
	if (!route) return null;
	const out = document.createElement("div");
	out.className = "docs-peek-ep";
	for (const part of [route, desc]) {
		if (!part) continue;
		const clone = document.importNode(part, true) as Element;
		clean(clone, path);
		out.append(clone);
	}
	if (groups.length) {
		const main = document.createElement("div");
		main.className = "apiref-main";
		for (const group of groups) {
			const clone = document.importNode(group, true) as Element;
			clean(clone, path);
			main.append(clone);
		}
		out.append(main);
	}
	return out;
}

export async function loadTarget(
	href: string,
	kind: PeekKind,
): Promise<Target | null> {
	const url = new URL(href, location.origin);
	const doc = await loadDocument(url.pathname);
	const article = doc?.getElementById("docs-article");
	if (!doc || !article) return null;
	const pageTitle =
		article.querySelector(".page-title")?.textContent?.trim() ?? "";
	const hash = decodeURIComponent(url.hash.slice(1));

	if (kind === "api") {
		const section = doc.getElementById(hash)?.closest("section.apiref-ep");
		const node = section ? endpoint(section, url.pathname) : null;
		if (!section || !node) return null;
		const title =
			section.querySelector(".apiref-ep-title")?.textContent?.trim() ?? "";
		return { title: title || pageTitle, pageTitle, nodes: [node] };
	}

	const children = [...article.children];
	const descriptors = children.map(describe);
	if (kind === "page") {
		const range = ledeRange(descriptors);
		if (!range || range.start === range.end || !pageTitle) return null;
		return {
			title: pageTitle,
			pageTitle,
			nodes: take(children, range, url.pathname),
		};
	}

	const range = sectionRange(descriptors, hash);
	if (!range || range.start === range.end) return null;
	const heading = doc.getElementById(hash);
	return {
		title: heading?.textContent?.trim() || pageTitle,
		pageTitle: pageTitle || heading?.textContent?.trim() || "",
		nodes: take(children, range, url.pathname),
	};
}
