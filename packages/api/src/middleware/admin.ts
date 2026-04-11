import { getDb } from "@secondlayer/shared/db";
import { ForbiddenError } from "@secondlayer/shared/errors";
import type { MiddlewareHandler } from "hono";

const ADMIN_EMAILS = ["ryan.waits@gmail.com"];

export function requireAdmin(): MiddlewareHandler {
	return async (c, next) => {
		const accountId = c.get("accountId");
		const db = getDb();

		const account = await db
			.selectFrom("accounts")
			.select("email")
			.where("id", "=", accountId)
			.executeTakeFirst();

		if (!account || !ADMIN_EMAILS.includes(account.email)) {
			throw new ForbiddenError("Admin access required");
		}

		await next();
	};
}
