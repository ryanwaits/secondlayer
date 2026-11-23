import { notify } from "@/components/toast/notify";
import { distinctId } from "@/lib/analytics";
import type { SigninFrom } from "@/lib/auth";
import {
	LASTING_KEY_NEXT,
	codeStepHref,
	docsKeyMintRequest,
	lastsFor,
	mintFailure,
} from "@/lib/code/docs-key-mint";
import {
	INITIAL_KEY_STATE,
	type KeyEvent,
	type KeyState,
	expiryDelay,
	isLive,
	nextKeyState,
} from "@/lib/code/docs-key-state";
import {
	ANON_OWNER,
	DOCS_KEY_FORGET,
	DOCS_KEY_STORE,
} from "@/lib/code/docs-key-store";
import { rememberNext } from "@/lib/safe-next";

/**
 * The key lives in this module's memory and in `sessionStorage`
 * (tab-scoped). It is never rendered on the server, never put in a URL, and
 * never leaves the slots it fills: each slot keeps the real key as text (so
 * Copy, which reads the row's text, copies it) and shows a mask drawn by CSS
 * from `data-mask`. The slots carry `ph-no-capture`, which keeps
 * them out of PostHog autocapture and replay.
 */

export type KeyReader = {
	accountId: string | null;
	login: (email: string, from: SigninFrom) => Promise<unknown>;
	navigate: (href: string) => void;
};

type HeldKey = Extract<KeyState["key"], { kind: "held" }>;

const MINUTE = 60_000;

let state: KeyState = INITIAL_KEY_STATE;
let reader: KeyReader | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let watching = false;
let panel: HTMLElement | null = null;
const originals = new WeakMap<Element, string>();

const ownerOf = (r: KeyReader) => r.accountId ?? ANON_OWNER;
const signedOut = () => state.owner === ANON_OWNER;
/** The key as it is now: read after a `dispatch`, which TypeScript cannot see changing `state`. */
const currentKey = () => state.key;
const heldKey = (): HeldKey | null =>
	state.key.kind === "held" ? state.key : null;
const mask = (key: string) => `sk-sl_…${key.slice(-4)}`;
const short = (key: string) => `${key.slice(0, 10)}…${key.slice(-4)}`;
const isLocalBase = () =>
	document.documentElement.getAttribute("data-base") === "local";

function dispatch(event: KeyEvent) {
	const before = state.key;
	state = nextKeyState(state, event);
	if (state.key !== before) keyChanged(before, state.key);
	paint();
}

function keyChanged(before: KeyState["key"], now: KeyState["key"]) {
	if (now.kind !== "held") {
		stop();
		return;
	}
	if (
		before.kind === "held" &&
		before.key === now.key &&
		before.expiresAt === now.expiresAt
	)
		return;
	try {
		sessionStorage.setItem(
			DOCS_KEY_STORE,
			JSON.stringify({
				key: now.key,
				expiresAt: now.expiresAt,
				accountId: now.owner,
			}),
		);
	} catch {}
	clearTimeout(timer);
	clearInterval(ticker);
	timer = setTimeout(
		() => dispatch({ type: "expire" }),
		expiryDelay(now.expiresAt),
	);
	ticker = setInterval(() => paint(), MINUTE);
}

function timeLeft(h: { expiresAt: string }): string {
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

const frameOf = (slot: Element) =>
	slot.closest<HTMLElement>(".cb-tabs") ?? slot.closest<HTMLElement>(".cb");

function fill(slot: HTMLElement, h: HeldKey) {
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
	if (h.revealed) slot.dataset.reveal = "";
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
	const held = heldKey();
	const expired = state.key.kind === "expired";
	const busy = state.key.kind === "minting";
	const limited = state.key.kind === "limited" ? state.key.text : null;
	for (const slot of slotsIn(root)) {
		if (held) {
			fill(slot, held);
			const frame = frameOf(slot);
			if (frame) keyed.add(frame);
		} else if (slot.hasAttribute("data-key")) restore(slot);
	}
	for (const frame of root.querySelectorAll<HTMLElement>(".cb-tabs"))
		if (frame.querySelector("[data-key-slot]")) note(frame, keyed.has(frame));
	const daily = limited !== null;
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
				? held.revealed
					? "Hide"
					: "Show"
				: expired
					? "Get a new docs key"
					: "Fill in a docs key";
	}
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
	} catch {}
}

export function forget() {
	dispatch({ type: "forget" });
	stop();
	closePanel();
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
		const h = JSON.parse(raw) as {
			key?: unknown;
			expiresAt?: unknown;
			accountId?: unknown;
		};
		if (
			typeof h.key === "string" &&
			h.key.startsWith("sk-sl_") &&
			typeof h.expiresAt === "string" &&
			h.accountId === owner
		) {
			if (expiryDelay(h.expiresAt) > 0)
				dispatch({
					type: "adopt",
					key: h.key,
					expiresAt: h.expiresAt,
					owner,
				});
			else dispatch({ type: "expire" });
			return;
		}
	} catch {}
	forget();
}

function fillPanel(el: HTMLElement) {
	const held = heldKey();
	const expired = state.key.kind === "expired";
	const { sending } = state.panel;
	const lasting = state.panel.mode === "lasting";
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
	const error = el.querySelector<HTMLElement>(".kp-error");
	if (error) {
		error.hidden = state.panel.error === null;
		error.textContent = state.panel.error ?? "";
	}
	const send = el.querySelector<HTMLButtonElement>(".kp-send");
	if (send) {
		send.disabled = sending;
		send.textContent = sending ? "Sending…" : "Email me a link";
	}
}

async function sendLink(event: SubmitEvent) {
	event.preventDefault();
	const form = event.currentTarget as HTMLFormElement;
	const input = form.querySelector<HTMLInputElement>(".kp-email");
	const email = input?.value.trim() ?? "";
	if (state.panel.sending || !reader || !email) return;
	const { login, navigate } = reader;
	dispatch({ type: "sendStart" });
	rememberNext(LASTING_KEY_NEXT);
	try {
		await login(email, "lasting_key");
	} catch (err) {
		// No email went out, so no link will need that destination: a later,
		// unrelated sign-in must not land on New key.
		rememberNext("/account");
		dispatch({
			type: "sendFailed",
			error:
				err instanceof Error
					? err.message
					: "Couldn't send the link. Try again.",
		});
		return;
	}
	dispatch({ type: "sendDone" });
	if (input) input.value = "";
	closePanel();
	notify.done("Check your email", {
		desc: `Click the link or enter the code we sent to ${email}.`,
		duration: 10_000,
		action: { label: "Enter code", run: () => navigate(codeStepHref(email)) },
	});
}

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
		if (!open) dispatch({ type: "panelClosed", at: performance.now() });
		for (const control of document.querySelectorAll(
			"[data-key-chip], [data-key-lasting]",
		))
			control.setAttribute("aria-expanded", String(open));
	});
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
	dispatch({ type: "panelShow", mode });
	if (mode === "lasting")
		panel?.querySelector<HTMLInputElement>(".kp-email")?.focus();
}

function togglePanelAt(anchor: HTMLElement, mode: "about" | "lasting") {
	const el = ensurePanel();
	if (el.matches(":popover-open")) {
		el.hidePopover();
		return;
	}
	if (performance.now() - state.panel.closedAt < 300) return;
	dispatch({ type: "panelShow", mode });
	fillPanel(el);
	const r = anchor.getBoundingClientRect();
	el.style.top = `${r.bottom + 8}px`;
	el.style.left = `${Math.max(16, Math.min(r.left, window.innerWidth - 376))}px`;
	el.showPopover();
	if (mode === "lasting")
		el.querySelector<HTMLInputElement>(".kp-email")?.focus();
}

export function togglePanel(chip: HTMLElement) {
	togglePanelAt(chip, "about");
}

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
	new MutationObserver(() => {
		const held = heldKey();
		if (held && !isLocalBase())
			for (const slot of slotsIn(document)) fill(slot, held);
	}).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-base"],
	});
	window.addEventListener(DOCS_KEY_FORGET, forget);
}

export function activate(next: KeyReader) {
	const owner = ownerOf(next);
	const switched = state.owner !== null && state.owner !== owner;
	reader = next;
	dispatch({ type: "activate", owner });
	if (switched) closePanel();
	watch();
	if (!isLive(state) && state.key.kind !== "minting") restoreStored(owner);
}

export async function useKey(): Promise<void> {
	if (state.key.kind === "minting" || reader === null) return;
	if (isLive(state)) {
		dispatch({ type: "toggleReveal" });
		return;
	}
	if (state.key.kind === "held") dispatch({ type: "expire" });
	dispatch({ type: "mint" });
	const started = currentKey();
	if (started.kind !== "minting") return;
	const { epoch } = started;
	const signedIn = reader.accountId !== null;
	const { url, init } = docsKeyMintRequest(signedIn, distinctId());
	closePanel();
	let event: KeyEvent;
	let flash: string | null = null;
	try {
		const res = await fetch(url, init);
		if (!res.ok) {
			const failure = mintFailure(res.status, signedIn);
			if (failure.kind === "daily") {
				event = { type: "mintLimited", epoch, text: failure.text };
			} else {
				event = { type: "mintFailed", epoch };
				flash = failure.text;
			}
		} else {
			const body = (await res.json()) as { key?: unknown; expiresAt?: unknown };
			if (
				typeof body.key === "string" &&
				body.key.startsWith("sk-sl_") &&
				typeof body.expiresAt === "string"
			) {
				event = {
					type: "minted",
					epoch,
					key: body.key,
					expiresAt: body.expiresAt,
				};
			} else {
				event = { type: "mintFailed", epoch };
				flash = "Try again";
			}
		}
	} catch {
		event = { type: "mintFailed", epoch };
		flash = "Try again";
	}
	if (state.epoch !== epoch) return;
	dispatch(event);
	if (flash) {
		for (const button of document.querySelectorAll<HTMLElement>(
			"[data-use-key]",
		))
			button.textContent = flash;
		setTimeout(() => paint(), 2400);
	}
}
