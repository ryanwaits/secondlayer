import { describe, expect, test } from "bun:test";
import { POST as loginPost } from "./auth/login/route";
import { POST as logoutPost } from "./auth/logout/route";
import { POST as verifyPost } from "./auth/verify/route";
import { PUT as alertsPut } from "./billing/alerts/route";
import { PATCH as capsPatch } from "./billing/caps/route";
import { POST as topupPost } from "./billing/topup/route";
import {
	DELETE as insightDelete,
	POST as insightPost,
} from "./insights/[id]/[action]/route";
import { DELETE as keyDelete } from "./keys/[id]/route";
import { POST as keysPost } from "./keys/route";
import { PUT as prefsPut } from "./push/prefs/route";
import {
	DELETE as pushDelete,
	POST as pushPost,
} from "./push/subscriptions/route";
import {
	PATCH as webhooksPatch,
	POST as webhooksPost,
} from "./webhooks/[[...path]]/route";

const HOST = "www.secondlayer.tools";
const URL_ = `https://${HOST}/api/test`;
const SESSION_COOKIE = "sl_session=ss-sl_fixture";

/** A request carrying a valid-looking session, so only the origin check can
 *  be what refuses it. */
function request(method: string, headers: Record<string, string>): Request {
	return new Request(URL_, {
		method,
		headers: {
			host: HOST,
			cookie: SESSION_COOKIE,
			"content-type": "application/json",
			...headers,
		},
		body: "{}",
	});
}

const insightParams = {
	params: Promise.resolve({
		id: "t:0b9c2f6e-1d4a-4c3b-8e7f-5a6d7c8b9e01",
		action: "dismiss",
	}),
};

const writes: Array<[string, (req: Request) => Promise<Response>, string]> = [
	["POST /api/keys", (req) => keysPost(req), "POST"],
	[
		"DELETE /api/keys/:id",
		(req) => keyDelete(req, { params: Promise.resolve({ id: "k" }) }),
		"DELETE",
	],
	["PATCH /api/billing/caps", (req) => capsPatch(req), "PATCH"],
	["PUT /api/billing/alerts", (req) => alertsPut(req), "PUT"],
	["POST /api/billing/topup", (req) => topupPost(req), "POST"],
	["PUT /api/push/prefs", (req) => prefsPut(req), "PUT"],
	["POST /api/auth/logout", (req) => logoutPost(req), "POST"],
	[
		"POST /api/webhooks/:id/pause",
		(req) =>
			webhooksPost(req, { params: Promise.resolve({ path: ["w", "pause"] }) }),
		"POST",
	],
	[
		"PATCH /api/webhooks/:id",
		(req) => webhooksPatch(req, { params: Promise.resolve({ path: ["w"] }) }),
		"PATCH",
	],
	["POST /api/push/subscriptions", (req) => pushPost(req), "POST"],
	["DELETE /api/push/subscriptions", (req) => pushDelete(req), "DELETE"],
	["POST /api/auth/verify", (req) => verifyPost(req), "POST"],
	["POST /api/auth/login", (req) => loginPost(req), "POST"],
	[
		"POST /api/insights/:id/:action",
		(req) => insightPost(req, insightParams),
		"POST",
	],
	[
		"DELETE /api/insights/:id/:action",
		(req) => insightDelete(req, insightParams),
		"DELETE",
	],
];

describe("credential and settings writes refuse a request from another site", () => {
	for (const [label, call, method] of writes) {
		test(`${label} without an Origin is 403 and not cached`, async () => {
			const res = await call(request(method, {}));
			expect(res.status).toBe(403);
			expect(res.headers.get("cache-control")).toBe("no-store");
		});

		test(`${label} from another origin is 403`, async () => {
			const res = await call(
				request(method, {
					origin: "https://evil.example",
					"sec-fetch-site": "cross-site",
				}),
			);
			expect(res.status).toBe(403);
		});
	}
});
