import { getSessionFromRequest } from "@/lib/api";
import { BundleSizeError, bundleWorkflowCode } from "@secondlayer/bundler";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
	const session = getSessionFromRequest(req);
	if (!session) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	let body: { code?: unknown };
	try {
		body = (await req.json()) as { code?: unknown };
	} catch {
		return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
	}

	if (typeof body.code !== "string" || body.code.length === 0) {
		return NextResponse.json(
			{ error: "Missing `code` string in body" },
			{ status: 400 },
		);
	}

	try {
		const bundled = await bundleWorkflowCode(body.code);
		return NextResponse.json({
			ok: true,
			name: bundled.name,
			trigger: bundled.trigger,
			handlerCode: bundled.handlerCode,
			sourceCode: bundled.sourceCode,
			retries: bundled.retries ?? null,
			timeout: bundled.timeout ?? null,
			bundleSize: Buffer.byteLength(bundled.handlerCode, "utf8"),
		});
	} catch (err) {
		if (err instanceof BundleSizeError) {
			return NextResponse.json(
				{
					ok: false,
					error: err.message,
					code: "BUNDLE_TOO_LARGE",
					actualBytes: err.actualBytes,
					maxBytes: err.maxBytes,
				},
				{ status: 413 },
			);
		}
		const message = err instanceof Error ? err.message : String(err);
		return NextResponse.json(
			{ ok: false, error: message, code: "BUNDLE_FAILED" },
			{ status: 400 },
		);
	}
}
