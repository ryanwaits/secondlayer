import { getDb } from "@secondlayer/shared/db";
import { NotFoundError, ValidationError } from "@secondlayer/shared/errors";
import {
	type InsightScope,
	dismissInsight,
	listInsights,
	muteRule,
	unmuteRule,
} from "@secondlayer/shared/insights";
import {
	type InsightListResponse,
	InsightResourceKindSchema,
} from "@secondlayer/shared/schemas/insights";
import { type Context, Hono } from "hono";

/**
 * Ranked insights, shared by the tenant surface (`/api/insights`, scope
 * `{ accountId: null }`: the stack's own database) and the platform surface
 * (`/api/accounts/insights`, scoped to the signed-in account). Only the
 * scope differs.
 */
export function createInsightsRoutes(
	getScope: (c: Context) => InsightScope,
): Hono {
	const app = new Hono();

	app.get("/", async (c) => {
		const filter = parseResource(c.req.query("resource"));
		const data = await listInsights(getDb(), getScope(c), new Date(), filter);
		return c.json({ data } satisfies InsightListResponse);
	});

	app.post("/:id/dismiss", async (c) => {
		const ok = await dismissInsight(getDb(), getScope(c), c.req.param("id"));
		if (!ok) throw notFound(c.req.param("id"));
		return c.json({ ok: true });
	});

	app.post("/:id/expected", async (c) => {
		const ok = await muteRule(getDb(), getScope(c), c.req.param("id"));
		if (!ok) throw notFound(c.req.param("id"));
		return c.json({ ok: true });
	});

	app.delete("/:id/expected", async (c) => {
		const ok = await unmuteRule(getDb(), getScope(c), c.req.param("id"));
		if (!ok) throw notFound(c.req.param("id"));
		return c.json({ ok: true });
	});

	return app;
}

function notFound(id: string): NotFoundError {
	return new NotFoundError(`No insight with id ${id}`);
}

/** `resource=<kind>:<id>`; the id may itself contain colons. */
function parseResource(raw: string | undefined): {
	kind?: string;
	id?: string;
} {
	if (raw === undefined || raw === "") return {};
	const split = raw.indexOf(":");
	const kind = split === -1 ? raw : raw.slice(0, split);
	const id = split === -1 ? "" : raw.slice(split + 1);
	const parsedKind = InsightResourceKindSchema.safeParse(kind);
	if (!parsedKind.success || id === "") {
		throw new ValidationError(
			"resource must look like <kind>:<id>, where kind is webhook, subgraph or account",
		);
	}
	return { kind: parsedKind.data, id };
}

/** Tenant surface: the stack's own insights (no account scoping). */
export default createInsightsRoutes(() => ({ accountId: null }));
