import { DOCS_KEY_FORGET, DOCS_KEY_STORE } from "@/lib/code/docs-key-store";

/**
 * A signed-in reader's docs key in the code samples. Loaded on demand by
 * `CodeClient`, only when the page has a `[data-use-key]` control and the
 * reader is signed in; nothing here is in the page's first load.
 *
 * The key is a read-only, 24 hour credential (Streams and Index). It lives in
 * this module's memory and in `sessionStorage` (tab-scoped). It is never
 * rendered on the server, never put in a URL, and never leaves the slots it
 * fills: each slot keeps the real key as text (so Copy, which reads the row's
 * text, copies it) and shows a mask drawn by CSS from `data-mask`. The slots
 * carry `ph-no-capture`, which keeps them out of PostHog autocapture and replay.
 */

type Held = { key: string; expiresAt: string; accountId: string };

const ENDPOINT = "/api/keys/docs";

let held: Held | null = null;
let signedIn: string | null = null;
let revealed = false;
let busy = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let watching = false;
/** A slot's own markup, to put back when the key goes away. */
const originals = new WeakMap<Element, string>();

const live = (h: Held) => Date.parse(h.expiresAt) > Date.now();
const mask = (key: string) => `sk-sl_…${key.slice(-4)}`;
const isLocalBase = () =>
	document.documentElement.getAttribute("data-base") === "local";

const slotsIn = (root: ParentNode): HTMLElement[] => [
	...(root instanceof HTMLElement && root.matches("[data-key-slot]")
		? [root]
		: []),
	...root.querySelectorAll<HTMLElement>("[data-key-slot]"),
];

function fill(slot: HTMLElement, h: Held) {
	// The Base URL switch owns the credential's text while it points at a
	// self-hosted instance; the key returns when it flips back to hosted.
	if (slot.hasAttribute("data-swap") && isLocalBase()) return;
	let real = slot.querySelector<HTMLElement>(":scope > .ks-real");
	if (!real) {
		originals.set(slot, slot.innerHTML);
		real = document.createElement("span");
		real.className = "ks-real";
		slot.replaceChildren(real);
	}
	real.textContent = h.key;
	slot.dataset.key = "";
	slot.dataset.mask = mask(h.key);
	if (revealed) slot.dataset.reveal = "";
	else delete slot.dataset.reveal;
}

function restore(slot: HTMLElement) {
	const original = originals.get(slot);
	if (original === undefined) return;
	slot.innerHTML = original;
	delete slot.dataset.key;
	delete slot.dataset.mask;
	delete slot.dataset.reveal;
	originals.delete(slot);
	if (slot.hasAttribute("data-swap") && isLocalBase()) {
		const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
		let first = true;
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			n.nodeValue = first ? "$INSTANCE_TOKEN" : "";
			first = false;
		}
	}
}

function paint(root: ParentNode = document) {
	for (const slot of slotsIn(root)) {
		if (held) fill(slot, held);
		else if (slot.hasAttribute("data-key")) restore(slot);
	}
	for (const button of root.querySelectorAll<HTMLButtonElement>(
		"[data-use-key]",
	)) {
		button.hidden = false;
		button.disabled = busy;
		button.dataset.state = held ? "on" : "";
		button.textContent = held
			? revealed
				? "Hide key"
				: "Show key"
			: "Use my key";
	}
}

/** Drop the key from memory, storage and every slot. */
export function forget() {
	held = null;
	revealed = false;
	clearTimeout(timer);
	try {
		sessionStorage.removeItem(DOCS_KEY_STORE);
	} catch {
		// Storage is optional; the in-memory key is already gone.
	}
	paint();
}

function hold(next: Held) {
	held = next;
	revealed = false;
	try {
		sessionStorage.setItem(DOCS_KEY_STORE, JSON.stringify(next));
	} catch {
		// Not persisted; the key still works on this page.
	}
	clearTimeout(timer);
	timer = setTimeout(
		forget,
		Math.max(0, Date.parse(next.expiresAt) - Date.now()),
	);
	paint();
}

function restoreStored(accountId: string) {
	let raw: string | null = null;
	try {
		raw = sessionStorage.getItem(DOCS_KEY_STORE);
	} catch {
		return;
	}
	if (!raw) return;
	try {
		const h = JSON.parse(raw) as Partial<Held>;
		if (
			typeof h.key === "string" &&
			h.key.startsWith("sk-sl_") &&
			typeof h.expiresAt === "string" &&
			h.accountId === accountId &&
			live(h as Held)
		) {
			hold(h as Held);
			return;
		}
	} catch {
		// Fall through: anything unreadable is dropped.
	}
	forget();
}

function watch() {
	if (watching) return;
	watching = true;
	new MutationObserver((records) => {
		for (const record of records)
			for (const node of record.addedNodes)
				if (node instanceof Element && !node.classList.contains("ks-real"))
					paint(node);
	}).observe(document.body, { childList: true, subtree: true });
	// The Base URL switch rewrites the credential's text; put the key back.
	new MutationObserver(() => {
		if (held && !isLocalBase())
			for (const slot of slotsIn(document)) fill(slot, held);
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-base"],
	});
	window.addEventListener(DOCS_KEY_FORGET, forget);
}

/** Show the controls and bring back this tab's key. Safe to call on every page. */
export function activate(accountId: string) {
	if (signedIn !== null && signedIn !== accountId) forget();
	signedIn = accountId;
	watch();
	if (held && live(held)) paint();
	else restoreStored(accountId);
	paint();
}

/** The control was clicked: mint the key, or flip between the mask and the key. */
export async function useKey(): Promise<void> {
	if (busy || signedIn === null) return;
	if (held && live(held)) {
		revealed = !revealed;
		paint();
		return;
	}
	busy = true;
	paint();
	let failed: string | null = null;
	try {
		const res = await fetch(ENDPOINT, {
			method: "POST",
			credentials: "same-origin",
			cache: "no-store",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});
		if (!res.ok) {
			failed = res.status === 429 ? "Limit reached" : "Try again";
		} else {
			const body = (await res.json()) as { key?: unknown; expiresAt?: unknown };
			if (
				typeof body.key === "string" &&
				body.key.startsWith("sk-sl_") &&
				typeof body.expiresAt === "string"
			)
				hold({ key: body.key, expiresAt: body.expiresAt, accountId: signedIn });
			else failed = "Try again";
		}
	} catch {
		failed = "Try again";
	}
	busy = false;
	paint();
	if (failed) {
		for (const button of document.querySelectorAll<HTMLElement>(
			"[data-use-key]",
		))
			button.textContent = failed;
		setTimeout(() => paint(), 2400);
	}
}
