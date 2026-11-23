"use client";

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

/** The fetch is handed to the clipboard as a pending item, so Safari still
 *  counts the write as part of the click. */
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
		} catch {}
	}
	return copyText(await load);
}
