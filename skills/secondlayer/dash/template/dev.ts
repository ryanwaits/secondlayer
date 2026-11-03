// bun dev.ts: serve this folder on PORT (default 4400) with the read-only
// proxy at /api/sl/*. Serves page files only: never .env*, api/ or lib/.
import { extname, join, normalize, sep } from "node:path";
import { GET } from "./api/sl/[...path].ts";

const dir = import.meta.dir;
const SERVED = new Set([
	".html",
	".css",
	".js",
	".json",
	".svg",
	".png",
	".ico",
]);
const HIDDEN = new Set(["api", "lib", "node_modules"]);

function staticFile(pathname: string): string | null {
	const rel = normalize(
		decodeURIComponent(pathname === "/" ? "/index.html" : pathname),
	);
	const parts = rel.split(/[\\/]/).filter(Boolean);
	if (parts.length === 0 || parts.some((p) => p.startsWith(".") || p === ".."))
		return null;
	if (HIDDEN.has(parts[0]) || !SERVED.has(extname(rel))) return null;
	const file = join(dir, ...parts);
	return file.startsWith(dir + sep) ? file : null;
}

const server = Bun.serve({
	port: Number(process.env.PORT ?? 4400),
	// Loopback only: the proxy reads with the account key.
	hostname: "127.0.0.1",
	idleTimeout: 30,
	async fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname.startsWith("/api/sl/")) {
			if (request.method !== "GET") {
				return Response.json(
					{ error: "The dash proxy only reads" },
					{ status: 405 },
				);
			}
			return GET(request);
		}
		let file: string | null = null;
		try {
			file = staticFile(pathname);
		} catch {}
		if (file && (await Bun.file(file).exists())) {
			return new Response(Bun.file(file), {
				headers: { "cache-control": "no-store" },
			});
		}
		return new Response("Not found", { status: 404 });
	},
});

console.log(`✓ http://localhost:${server.port}`);
