/**
 * Browser side of web push for the installed phone app. `pushState` is pure
 * so every state is testable; `turnOnPush` / `turnOffPush` are the thin calls
 * into the service worker and the account's push API.
 */

export type PushState =
	/** No service worker, PushManager or Notification. */
	| "unsupported"
	/** iOS Safari outside the home-screen app. */
	| "needs_install"
	/** The server has no VAPID key. */
	| "unavailable"
	/** The person said no in the browser's settings. */
	| "blocked"
	/** Supported, not subscribed. */
	| "off"
	/** Subscribed. */
	| "on";

export interface PushEnv {
	hasServiceWorker: boolean;
	hasPushManager: boolean;
	isIos: boolean;
	standalone: boolean;
	permission: NotificationPermission | null;
	subscribed: boolean;
	publicKey: string | null;
}

export function pushState(env: PushEnv): PushState {
	if (env.isIos && !env.standalone) return "needs_install";
	if (!env.hasServiceWorker || !env.hasPushManager || env.permission === null) {
		return "unsupported";
	}
	if (!env.publicKey) return "unavailable";
	if (env.permission === "denied") return "blocked";
	return env.subscribed && env.permission === "granted" ? "on" : "off";
}

/** The VAPID public key as the bytes `pushManager.subscribe` wants. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

function isIos(): boolean {
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
	);
}

function isStandalone(): boolean {
	return (
		window.matchMedia("(display-mode: standalone)").matches ||
		(navigator as { standalone?: boolean }).standalone === true
	);
}

async function currentSubscription(): Promise<PushSubscription | null> {
	if (!("serviceWorker" in navigator)) return null;
	const registration =
		await navigator.serviceWorker.getRegistration("/account/");
	return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Reads this browser's push state; `publicKey` comes from `GET /api/push/prefs`. */
export async function readPushState(
	publicKey: string | null,
): Promise<PushState> {
	return pushState({
		hasServiceWorker: "serviceWorker" in navigator,
		hasPushManager: "PushManager" in window,
		isIos: isIos(),
		standalone: isStandalone(),
		permission: "Notification" in window ? Notification.permission : null,
		subscribed: (await currentSubscription()) !== null,
		publicKey,
	});
}

/** Asks for permission and subscribes. Call only from a tap. */
export async function turnOnPush(publicKey: string): Promise<void> {
	const registration = await navigator.serviceWorker.register("/sw.js", {
		scope: "/account/",
	});
	await navigator.serviceWorker.ready;
	if ((await Notification.requestPermission()) !== "granted") {
		throw new Error("Notifications are blocked");
	}
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: urlBase64ToUint8Array(publicKey),
	});
	const res = await fetch("/api/push/subscriptions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			...subscription.toJSON(),
			userAgent: navigator.userAgent.slice(0, 300),
		}),
	});
	if (!res.ok) {
		await subscription.unsubscribe();
		throw new Error("Couldn't register this device");
	}
}

export async function turnOffPush(): Promise<void> {
	const subscription = await currentSubscription();
	if (!subscription) return;
	const res = await fetch("/api/push/subscriptions", {
		method: "DELETE",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ endpoint: subscription.endpoint }),
	});
	if (!res.ok) throw new Error("Couldn't turn push off");
	await subscription.unsubscribe();
}
