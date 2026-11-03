// A stub Secondlayer API for the dash proxy and probe tests. Records every
// request so a test can assert what reached the upstream.
export interface Seen {
	path: string;
	authorization: string | null;
	cookie: string | null;
}

export interface Stub {
	url: string;
	seen: Seen[];
	stop(): void;
}

const WEBHOOK = {
	id: "wh_1",
	name: "sbtc-deposits",
	status: "active",
	triggers: [{ type: "contract_call" }],
};

export function startUpstream(): Stub {
	const seen: Seen[] = [];
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const { pathname } = new URL(request.url);
			seen.push({
				path: `${pathname}${new URL(request.url).search}`,
				authorization: request.headers.get("authorization"),
				cookie: request.headers.get("cookie"),
			});
			// Strip the network prefix the bases add (testnet, devnet).
			const path = pathname.replace(/^\/(testnet|devnet)(?=\/)/, "");
			// Hosted testnet answers /health with a 404, like production does.
			if (pathname === "/testnet/health") {
				return Response.json({ error: "Not found" }, { status: 404 });
			}
			if (path === "/health") return Response.json({ status: "ok" });
			if (path === "/api/webhooks") {
				return Response.json(
					{
						data: [
							{ id: WEBHOOK.id, name: WEBHOOK.name, status: WEBHOOK.status },
						],
					},
					{ headers: { "set-cookie": "session=leak; Path=/" } },
				);
			}
			if (path === `/api/webhooks/${WEBHOOK.id}`) return Response.json(WEBHOOK);
			if (path === "/api/subgraphs") {
				return Response.json({ data: [{ name: "vault-flows" }] });
			}
			if (path === "/api/subgraphs/vault-flows") {
				return Response.json({
					tables: {
						deposits: {
							columns: {
								sender: { type: "principal" },
								amount: { type: "uint" },
							},
						},
					},
				});
			}
			if (path === "/api/billing/usage") {
				return Response.json({ month: "2026-11", usage: [], daily: [] });
			}
			return Response.json({ error: "Not found" }, { status: 404 });
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		seen,
		stop: () => server.stop(true),
	};
}

/** A loopback URL with nothing listening, for an unreachable network. */
export function closedUrl(): string {
	const server = Bun.serve({ port: 0, fetch: () => new Response() });
	const url = `http://127.0.0.1:${server.port}`;
	server.stop(true);
	return url;
}
