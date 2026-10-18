/**
 * Whether a push subscription endpoint belongs to a real browser push service.
 * The platform POSTs to stored endpoints, so anything else (an internal host, a
 * cloud metadata address) would be a way to make the server call arbitrary
 * hosts. Allowed hosts, by the browsers they serve:
 *
 * - `fcm.googleapis.com`: Chrome, Edge and other Chromium browsers (FCM)
 * - `web.push.apple.com` and `*.push.apple.com`: Safari and iOS home-screen apps
 * - `*.push.services.mozilla.com`: Firefox (autopush)
 * - `*.notify.windows.com`: legacy Edge (WNS)
 *
 * https only, no credentials, and no port other than 443.
 */
export function isPushServiceEndpoint(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	if (parsed.username || parsed.password) return false;
	if (parsed.port && parsed.port !== "443") return false;
	const host = parsed.hostname.toLowerCase();
	return (
		host === "fcm.googleapis.com" ||
		host === "web.push.apple.com" ||
		host.endsWith(".push.services.mozilla.com") ||
		host.endsWith(".notify.windows.com") ||
		host.endsWith(".push.apple.com")
	);
}
