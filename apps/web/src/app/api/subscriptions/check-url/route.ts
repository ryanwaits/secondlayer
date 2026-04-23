import { NextResponse } from "next/server";

const PRIVATE_RANGES = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^169\.254\./,
	/^0\./,
];

/**
 * Best-effort reachability check — HEAD request with 30s timeout. Does
 * NOT block subscription creation on failure; the form surfaces a
 * warning and still allows save. Rejects private IP ranges unless
 * SECONDLAYER_ALLOW_PRIVATE_EGRESS=true (Sprint 6 will formalize).
 */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { url?: string };
	if (!body.url) {
		return NextResponse.json(
			{ reachable: false, reason: "missing url" },
			{ status: 400 },
		);
	}

	let target: URL;
	try {
		target = new URL(body.url);
	} catch {
		return NextResponse.json({ reachable: false, reason: "invalid url" });
	}
	if (target.protocol !== "http:" && target.protocol !== "https:") {
		return NextResponse.json({ reachable: false, reason: "invalid protocol" });
	}

	if (process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS !== "true") {
		const host = target.hostname;
		if (PRIVATE_RANGES.some((r) => r.test(host)) || host === "localhost") {
			return NextResponse.json({
				reachable: false,
				reason: "private address rejected",
			});
		}
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30_000);
	try {
		const res = await fetch(target, {
			method: "HEAD",
			signal: controller.signal,
			redirect: "follow",
		});
		return NextResponse.json({
			reachable: res.ok || res.status < 500,
			status: res.status,
		});
	} catch (err) {
		return NextResponse.json({
			reachable: false,
			reason: err instanceof Error ? err.message : "network error",
		});
	} finally {
		clearTimeout(timer);
	}
}
