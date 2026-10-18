// Push only. No fetch handler: this worker never caches or intercepts pages.
self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {}
	const title = data.title || "Secondlayer";
	event.waitUntil(
		self.registration.showNotification(title, {
			body: data.body || "",
			tag: data.tag,
			// Only same-origin paths open; anything else falls back to the account.
			data: {
				url:
					typeof data.url === "string" &&
					data.url.startsWith("/") &&
					!data.url.startsWith("//")
						? data.url
						: "/account",
			},
			icon: "/pwa-icon/192",
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = event.notification.data?.url || "/account";
	event.waitUntil(
		(async () => {
			const all = await self.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			for (const client of all) {
				if (
					new URL(client.url).pathname.startsWith("/account") &&
					"focus" in client
				) {
					await client.navigate(url).catch(() => {});
					return client.focus();
				}
			}
			return self.clients.openWindow(url);
		})(),
	);
});
