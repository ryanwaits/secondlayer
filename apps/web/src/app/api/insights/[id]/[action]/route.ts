import { ApiError, apiRequest, getSessionFromRequest } from "@/lib/api";
import { NextResponse } from "next/server";

/**
 * Dismiss an insight, or mark it expected (and undo that). The id carries the
 * side that owns it: `t:<uuid>` is the stack's, `a:<uuid>` the account's.
 */

const UUID_RE = /^[0-9a-f-]{36}$/;

type Params = { params: Promise<{ id: string; action: string }> };

function invalid(error: string) {
	return NextResponse.json({ error }, { status: 400 });
}

async function handle(
	req: Request,
	method: "POST" | "DELETE",
	{ params }: Params,
): Promise<NextResponse> {
	const sessionToken = getSessionFromRequest(req);
	if (!sessionToken) {
		return NextResponse.json({ error: "Sign in first" }, { status: 401 });
	}

	const { id: prefixed, action } = await params;
	const allowed =
		method === "POST"
			? action === "dismiss" || action === "expected"
			: action === "expected";
	if (!allowed) return invalid("Invalid action");

	const parts = decodeURIComponent(prefixed).split(":");
	const [prefix, id] = parts;
	if (parts.length !== 2 || (prefix !== "t" && prefix !== "a")) {
		return invalid("Invalid insight id");
	}
	if (!id || !UUID_RE.test(id)) return invalid("Invalid insight id");

	const base = prefix === "t" ? "/api/insights" : "/api/accounts/insights";
	try {
		const result = await apiRequest<unknown>(`${base}/${id}/${action}`, {
			method,
			sessionToken,
		});
		return NextResponse.json(result);
	} catch (e) {
		if (e instanceof ApiError) {
			return NextResponse.json({ error: e.message }, { status: e.status });
		}
		return NextResponse.json({ error: "Internal error" }, { status: 500 });
	}
}

export function POST(req: Request, context: Params) {
	return handle(req, "POST", context);
}

export function DELETE(req: Request, context: Params) {
	return handle(req, "DELETE", context);
}
