import { getSessionFromRequest } from "@/lib/api";
import { buildWorkflowDiff } from "@/lib/sessions/diff-workflow";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const session = getSessionFromRequest(req);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { name?: unknown; currentCode?: unknown; proposedCode?: unknown };
	try {
		body = (await req.json()) as {
			name?: unknown;
			currentCode?: unknown;
			proposedCode?: unknown;
		};
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (
		typeof body.name !== "string" ||
		typeof body.currentCode !== "string" ||
		typeof body.proposedCode !== "string"
	) {
		return NextResponse.json(
			{ error: "name, currentCode, proposedCode required as strings" },
			{ status: 400 },
		);
	}

	const diff = await buildWorkflowDiff(
		body.currentCode,
		body.proposedCode,
		`workflows/${body.name}.ts`,
	);

	return NextResponse.json(diff);
}
