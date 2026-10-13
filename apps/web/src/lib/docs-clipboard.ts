"use client";

/** Last resort when the async clipboard API refuses: select + execCommand. */
function copyViaTextarea(text: string): boolean {
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.setAttribute("readonly", "");
	ta.style.position = "fixed";
	ta.style.opacity = "0";
	document.body.appendChild(ta);
	ta.select();
	let ok = false;
	try {
		ok = document.execCommand("copy");
	} catch {
		ok = false;
	}
	document.body.removeChild(ta);
	return ok;
}

export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return copyViaTextarea(text);
	}
}

/** Fetch the page's markdown and put it on the clipboard. The fetch is handed
 *  to the clipboard as a pending item, so Safari still counts the write as
 *  part of the click; other browsers fall back to writeText, then a textarea. */
export async function copyMarkdown(url: string): Promise<boolean> {
	const load = fetch(url)
		.then((res) => {
			if (!res.ok) throw new Error(`${res.status} ${url}`);
			return res.text();
		})
		// The route prefixes a `<!-- source: … -->` line; the page starts below it.
		.then((text) => text.replace(/^<!--[\s\S]*?-->\s*/, ""));
	if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/plain": load.then((t) => new Blob([t], { type: "text/plain" })),
				}),
			]);
			return true;
		} catch {
			// Fall through; a failed fetch rejects again below.
		}
	}
	return copyText(await load);
}
