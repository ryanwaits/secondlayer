import type { Database, Session } from "@secondlayer/shared/db";
import type { Kysely } from "kysely";

/**
 * Single source of truth for "is this `sessions` row usable" — shared by
 * `requireAuth()`'s `ss-sl_*` branch (`./middleware.ts`) and the internal
 * introspect route (`../routes/internal-introspect.ts`), so a session that
 * `/api/*` would refuse can never introspect as good.
 */
export type SessionLookup =
	| { status: "ok"; session: Session }
	| { status: "not_found" }
	| { status: "revoked" }
	| { status: "expired" };

export async function lookupSession(
	db: Kysely<Database>,
	tokenHash: string,
): Promise<SessionLookup> {
	const session = await db
		.selectFrom("sessions")
		.selectAll()
		.where("token_hash", "=", tokenHash)
		.executeTakeFirst();

	if (!session) return { status: "not_found" };
	if (session.revoked_at) return { status: "revoked" };
	if (new Date(session.expires_at) < new Date()) return { status: "expired" };
	return { status: "ok", session };
}
