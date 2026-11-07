import { notify } from "@/components/toast/notify";
import {
	LASTING_KEY_NEXT,
	codeStepHref,
	docsKeyMintRequest,
	lastsFor,
	mintFailure,
} from "@/lib/code/docs-key-mint";
import {
	ANON_OWNER,
	DOCS_KEY_FORGET,
	DOCS_KEY_STORE,
} from "@/lib/code/docs-key-store";
import { rememberNext } from "@/lib/safe-next";

/**
 * The reader's docs key in the code samples. Loaded on demand by `CodeClient`,
 * only when the page has a `[data-use-key]` control; nothing here is in the
 * page's first load.
 *
 * The key is a read-only, 24 hour credential (Streams and Index). Signed in,
 * the account mints it; signed out, the API mints it for a ghost account, one
 * a day per IP. It lives in this module's memory and in `sessionStorage`
 * (tab-scoped). It is never rendered on the server, never put in a URL, and
 * never leaves the slots it fills: each slot keeps the real key as text (so
 * Copy, which reads the row's text, copies it) and shows a mask drawn by CSS
 * from `data-mask`. A slot with `data-quote` sits in an SDK sample and takes
 * the key as a string literal. The slots carry `ph-no-capture`, which keeps
 * them out of PostHog autocapture and replay.
 *
 * Controls: a chip names the key (`sk-sl_9f4c…a3f9 · 23h left`) and opens a
 * panel about it; one link mints it, then shows and hides it. When the key
 * expires the chip says so and the samples go back to their placeholder.
 * Signed out, "Make a lasting key" opens the panel on a sign-in form: the
 * emailed link or code signs the reader in and lands on New key.
 */

/** Who is reading, and what the page lends the module to sign them in. */
export type KeyReader = {
	/** The signed-in account's id; null for a signed-out reader. */
	accountId: string | null;
	/** Emails a sign-in link and code (`useAuth().login`). */
	login: (email: string) => Promise<unknown>;
	/** Client-side navigation. */
	navigate: (href: string) => void;
};

type Held = { key: string; expiresAt: string; accountId: string };

const MINUTE = 60_000;

let held: Held | null = null;
let reader: KeyReader | null = null;
let revealed = false;
let expired = false;
let busy = false;
/** Signed out and already given today's key: what the note says instead of the action. */
let limited: string | null = null;
let sending = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let watching = false;
let panel: HTMLElement | null = null;
/** What the panel shows: the key, or the sign-in form for a lasting one. */
let panelMode: "about" | "lasting" = "about";
/** When the panel last closed: a click on the chip light-dismisses it first, and must not reopen it. */
let closedAt = 0;
/** A slot's own markup, to put back when the key goes away. */
const originals = new WeakMap<Element, string>();

const ownerOf = (r: KeyReader) => r.accountId ?? ANON_OWNER;
const signedOut = () => reader !== null && reader.accountId === null;
const live = (h: Held) => Date.parse(h.expiresAt) > Date.now();
const mask = (key: string) => `sk-sl_…${key.slice(-4)}`;
const short = (key: string) => `${key.slice(0, 10)}…${key.slice(-4)}`;
const isLocalBase = () =>
	document.documentElement.getAttribute("data-base") === "local";

function timeLeft(h: Held): string {
	const minutes = Math.max(
		1,
		Math.ceil((Date.parse(h.expiresAt) - Date.now()) / MINUTE),
	);
	return minutes < 60
		? `${minutes}m left`
		: `${Math.floor(minutes / 60)}h left`;
}

const slotsIn = (root: ParentNode): HTMLElement[] => [
	...(root instanceof HTMLElement && root.matches("[data-key-slot]")
		? [root]
		: []),
	...root.querySelectorAll<HTMLElement>("[data-key-slot]"),
];

/** The outer frame of the block a slot sits in: a tab group, or the block itself. */
const frameOf = (slot: Element) =>
	slot.closest<HTMLElement>(".cb-tabs") ?? slot.closest<HTMLElement>(".cb");

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
	const quote = slot.hasAttribute("data-quote") ? '"' : "";
	real.textContent = `${quote}${h.key}${quote}`;
	slot.dataset.key = "";
	slot.dataset.mask = `${quote}${mask(h.key)}${quote}`;
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

/** The line under a keyed block that says its samples carry the docs key. */
function note(frame: HTMLElement, on: boolean) {
	const existing = frame.querySelector<HTMLElement>(":scope > .key-note");
	if (!on) {
		existing?.remove();
		return;
	}
	if (existing) return;
	const p = document.createElement("p");
	p.className = "key-note";
	p.textContent =
		"Samples on this page use your docs key. Copy includes the full key.";
	frame.append(p);
}

function paint(root: ParentNode = document) {
	const keyed = new Set<HTMLElement>();
	for (const slot of slotsIn(root)) {
		if (held) {
			fill(slot, held);
			const frame = frameOf(slot);
			if (frame) keyed.add(frame);
		} else if (slot.hasAttribute("data-key")) restore(slot);
	}
	for (const frame of root.querySelectorAll<HTMLElement>(".cb-tabs"))
		if (frame.querySelector("[data-key-slot]")) note(frame, keyed.has(frame));
	const daily = !held && limited !== null;
	for (const chip of root.querySelectorAll<HTMLButtonElement>(
		"[data-key-chip]",
	)) {
		chip.hidden = daily || (!held && !expired);
		chip.dataset.state = expired ? "expired" : "";
		chip.textContent = held
			? `${short(held.key)} · ${timeLeft(held)}`
			: "Key expired";
	}
	for (const msg of root.querySelectorAll<HTMLElement>("[data-key-msg]")) {
		msg.hidden = !daily;
		msg.textContent = daily ? limited : "";
	}
	for (const button of root.querySelectorAll<HTMLButtonElement>(
		"[data-use-key]",
	)) {
		button.hidden = daily;
		button.disabled = busy;
		button.textContent = busy
			? "Making key…"
			: held
				? revealed
					? "Hide"
					: "Show"
				: expired
					? "Get a new docs key"
					: "Fill in a docs key";
	}
	// Signed in, the panel's link goes to the keys page as it always has.
	for (const link of root.querySelectorAll<HTMLButtonElement>(
		"[data-key-lasting]",
	))
		link.hidden = !signedOut() || !(held || expired || daily);
	if (panel?.matches(":popover-open")) fillPanel(panel);
}

function stop() {
	clearTimeout(timer);
	clearInterval(ticker);
	try {
		sessionStorage.removeItem(DOCS_KEY_STORE);
	} catch {
		// Storage is optional; the in-memory key is already gone.
	}
}

/** Drop the key from memory, storage and every slot. */
export function forget() {
	held = null;
	revealed = false;
	expired = false;
	stop();
	closePanel();
	paint();
}

/** The key ran out: samples go back to their placeholder and the chip says so. */
function expire() {
	held = null;
	revealed = false;
	expired = true;
	stop();
	paint();
}

function hold(next: Held) {
	held = next;
	revealed = false;
	expired = false;
	limited = null;
	try {
		sessionStorage.setItem(DOCS_KEY_STORE, JSON.stringify(next));
	} catch {
		// Not persisted; the key still works on this page.
	}
	clearTimeout(timer);
	clearInterval(ticker);
	timer = setTimeout(
		expire,
		Math.max(0, Date.parse(next.expiresAt) - Date.now()),
	);
	// The chip's "23h left" counts down.
	ticker = setInterval(() => paint(), MINUTE);
	paint();
}

function restoreStored(owner: string) {
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
			h.accountId === owner
		) {
			if (live(h as Held)) hold(h as Held);
			else expire();
			return;
		}
	} catch {
		// Fall through: anything unreadable is dropped.
	}
	forget();
}

function fillPanel(el: HTMLElement) {
	const lasting = panelMode === "lasting";
	el.setAttribute("aria-label", lasting ? "Make a lasting key" : "Docs key");
	const about = el.querySelector<HTMLElement>(".kp-about");
	const form = el.querySelector<HTMLFormElement>(".kp-lasting");
	if (about) about.hidden = lasting;
	if (form) form.hidden = !lasting;

	const at = held?.expiresAt;
	const when = at
		? new Date(at).toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			})
		: "";
	el.dataset.state = expired ? "expired" : "";
	const set = (selector: string, text: string) => {
		const node = el.querySelector(selector);
		if (node) node.textContent = text;
	};
	set(".kp-title", expired ? "Docs key expired" : "Docs key");
	set(".kp-key", held ? mask(held.key) : "None");
	set(".kp-exp", expired ? "Expired" : when);
	set(
		".kp-body",
		held
			? `Sign in with your email, then make your own key. This one keeps working for ${lastsFor(held.expiresAt)}.`
			: "Sign in with your email, then make your own key.",
	);
	const forgetButton = el.querySelector<HTMLElement>(".kp-forget");
	if (forgetButton) forgetButton.hidden = !held;
	const send = el.querySelector<HTMLButtonElement>(".kp-send");
	if (send) {
		send.disabled = sending;
		send.textContent = sending ? "Sending…" : "Email me a link";
	}
}

function showError(text: string | null) {
	const error = panel?.querySelector<HTMLElement>(".kp-error");
	if (!error) return;
	error.hidden = text === null;
	error.textContent = text ?? "";
}

/** The lasting-key form was sent: email a sign-in link, then say where it went. */
async function sendLink(event: SubmitEvent) {
	event.preventDefault();
	const form = event.currentTarget as HTMLFormElement;
	const input = form.querySelector<HTMLInputElement>(".kp-email");
	const email = input?.value.trim() ?? "";
	if (sending || !reader || !email) return;
	const { login, navigate } = reader;
	sending = true;
	showError(null);
	if (panel) fillPanel(panel);
	// The emailed link opens in a new tab; it finds where to go here.
	rememberNext(LASTING_KEY_NEXT);
	try {
		await login(email);
	} catch (err) {
		sending = false;
		if (panel) fillPanel(panel);
		showError(
			err instanceof Error ? err.message : "Couldn't send the link. Try again.",
		);
		return;
	}
	sending = false;
	if (input) input.value = "";
	closePanel();
	notify.done("Check your email", {
		desc: `Click the link or enter the code we sent to ${email}.`,
		duration: 10_000,
		action: { label: "Enter code", run: () => navigate(codeStepHref(email)) },
	});
}

/** The panel the chip opens: built once, in the top layer, so no frame clips it. */
function ensurePanel(): HTMLElement {
	if (panel) return panel;
	const el = document.createElement("div");
	el.className = "key-panel";
	el.setAttribute("popover", "");
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", "Docs key");
	el.innerHTML =
		'<div class="kp-about">' +
		'<p class="kp-head"><span class="kp-title"></span></p>' +
		"<p>A temporary key made for these docs. It fills the samples on this tab that read Streams and Index, and stops working after 24 hours.</p>" +
		'<dl class="mono"><dt>Key</dt><dd class="kp-key ph-no-capture"></dd><dt>Can</dt><dd>Read Streams and Index</dd><dt>Expires</dt><dd class="kp-exp"></dd></dl>' +
		'<div class="kp-actions"><button type="button" class="kp-forget">Forget key</button><a class="kp-make" href="/account/keys">Make a lasting key</a></div>' +
		"</div>" +
		'<form class="kp-lasting" hidden>' +
		'<p class="kp-head">Make a lasting key</p>' +
		'<p class="kp-body"></p>' +
		'<div class="kp-row"><input class="kp-email ph-no-capture" type="email" name="email" required autocomplete="email" placeholder="name@domain.com" aria-label="Email"><button type="submit" class="kp-send">Email me a link</button></div>' +
		'<p class="kp-error" role="alert" hidden></p>' +
		'<p class="kp-fine">New here? This creates your account.</p>' +
		"</form>";
	el.querySelector(".kp-forget")?.addEventListener("click", forget);
	// Signed out there is no keys page yet: the link turns the panel into the sign-in form.
	el.querySelector(".kp-make")?.addEventListener("click", (e) => {
		if (!signedOut()) return;
		e.preventDefault();
		showMode("lasting");
	});
	el.querySelector(".kp-lasting")?.addEventListener("submit", (e) => {
		void sendLink(e as SubmitEvent);
	});
	el.addEventListener("toggle", (e) => {
		const open = (e as ToggleEvent).newState === "open";
		if (!open) closedAt = performance.now();
		for (const control of document.querySelectorAll(
			"[data-key-chip], [data-key-lasting]",
		))
			control.setAttribute("aria-expanded", String(open));
	});
	// It is placed from the chip once; scrolling away closes it rather than leaving it adrift.
	window.addEventListener(
		"scroll",
		() => {
			if (el.matches(":popover-open")) el.hidePopover();
		},
		{ passive: true },
	);
	document.body.append(el);
	panel = el;
	return el;
}

function closePanel() {
	if (panel?.matches(":popover-open")) panel.hidePopover();
}

function showMode(mode: "about" | "lasting") {
	panelMode = mode;
	showError(null);
	if (!panel) return;
	fillPanel(panel);
	if (mode === "lasting")
		panel.querySelector<HTMLInputElement>(".kp-email")?.focus();
}

/** Open or close the panel under `anchor`, showing `mode`. */
function togglePanelAt(anchor: HTMLElement, mode: "about" | "lasting") {
	const el = ensurePanel();
	if (el.matches(":popover-open")) {
		el.hidePopover();
		return;
	}
	if (performance.now() - closedAt < 300) return;
	panelMode = mode;
	showError(null);
	fillPanel(el);
	const r = anchor.getBoundingClientRect();
	el.style.top = `${r.bottom + 8}px`;
	el.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - 376))}px`;
	el.showPopover();
	if (mode === "lasting")
		el.querySelector<HTMLInputElement>(".kp-email")?.focus();
}

/** The chip was clicked: open or close the panel about the key. */
export function togglePanel(chip: HTMLElement) {
	togglePanelAt(chip, "about");
}

/** "Make a lasting key" was clicked (signed out): open or close the sign-in form. */
export function toggleLasting(link: HTMLElement) {
	togglePanelAt(link, "lasting");
}

function watch() {
	if (watching) return;
	watching = true;
	new MutationObserver((records) => {
		for (const record of records)
			for (const node of record.addedNodes)
				if (
					node instanceof Element &&
					!node.classList.contains("ks-real") &&
					!node.classList.contains("key-note") &&
					node !== panel
				)
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
export function activate(next: KeyReader) {
	if (reader !== null && ownerOf(reader) !== ownerOf(next)) {
		limited = null;
		forget();
	}
	reader = next;
	watch();
	if (held && live(held)) paint();
	else restoreStored(ownerOf(next));
	paint();
}

/** The link was clicked: mint the key, or flip between the mask and the key. */
export async function useKey(): Promise<void> {
	if (busy || reader === null) return;
	if (held && live(held)) {
		revealed = !revealed;
		paint();
		return;
	}
	const owner = ownerOf(reader);
	const signedIn = reader.accountId !== null;
	const { url, init } = docsKeyMintRequest(signedIn);
	busy = true;
	closePanel();
	paint();
	let flash: string | null = null;
	try {
		const res = await fetch(url, init);
		if (!res.ok) {
			const failure = mintFailure(res.status, signedIn);
			if (failure.kind === "daily") limited = failure.text;
			else flash = failure.text;
		} else {
			const body = (await res.json()) as { key?: unknown; expiresAt?: unknown };
			if (
				typeof body.key === "string" &&
				body.key.startsWith("sk-sl_") &&
				typeof body.expiresAt === "string"
			)
				hold({ key: body.key, expiresAt: body.expiresAt, accountId: owner });
			else flash = "Try again";
		}
	} catch {
		flash = "Try again";
	}
	busy = false;
	paint();
	if (flash) {
		for (const button of document.querySelectorAll<HTMLElement>(
			"[data-use-key]",
		))
			button.textContent = flash;
		setTimeout(() => paint(), 2400);
	}
}
