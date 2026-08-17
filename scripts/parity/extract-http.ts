/**
 * Parity-audit extractor for the HTTP API surface.
 *
 * Sources:
 *  - packages/api/src/route-manifest.ts — plane fixtures (deleted routes are
 *    included in the output, flagged, since the manifest guarantees they 404
 *    forever).
 *  - packages/api/src/create-app.ts — live surface, walked via Hono's
 *    `.routes` for both instance modes (oss + platform). No server is
 *    started, no DB touched, no network calls.
 *
 * Output: scripts/parity/out/http.json
 * Run: bun scripts/parity/extract-http.ts
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiApp } from "../../packages/api/src/create-app.ts";
import {
	DELETED_ROUTE_FIXTURES,
	HOSTED_ROUTE_FIXTURES,
	RETAINED_METER_ROUTE_FIXTURES,
	RETAINED_ROUTE_FIXTURES,
	WORKLOAD_ROUTE_FIXTURES,
} from "../../packages/api/src/route-manifest.ts";

type Plane = "retained" | "workload" | "metered" | "hosted" | "deleted";

interface Item {
	id: string;
	group: string;
	plane: Plane;
}

/** Mount-table planes, mirroring create-app.ts:
 *  workload = mode !== platform mounts; metered = platform-only mounts. */
const WORKLOAD_PREFIXES = ["/api/subgraphs", "/api/subscriptions", "/api/node"];
const METERED_PREFIXES = [
	"/api/keys",
	"/api/auth",
	"/api/webhooks",
	"/api/public/credits",
	"/api/accounts",
	"/api/billing",
	"/api/archive",
];

const hostedIds = new Set(
	HOSTED_ROUTE_FIXTURES.map((f: { method: string; path: string }) =>
		routeId(f.method, f.path),
	),
);

function routeId(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

function startsWithPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

function planeFor(method: string, path: string): Plane {
	if (hostedIds.has(routeId(method, path))) return "hosted";
	if (WORKLOAD_PREFIXES.some((p) => startsWithPrefix(path, p)))
		return "workload";
	if (METERED_PREFIXES.some((p) => startsWithPrefix(path, p))) return "metered";
	return "retained";
}

function groupFor(path: string): string {
	if (path.includes("x402")) return "x402";
	const segments = path.split("/").filter(Boolean);
	if (segments.length === 0) return "core";
	const first = segments[0];
	if (first === "v1" || first === "api") {
		const second = segments[1];
		if (!second) return "core";
		return second.replace(/\.json$/, "");
	}
	return first;
}

function collectLiveRoutes(): Map<string, Item> {
	const items = new Map<string, Item>();
	for (const mode of ["oss", "platform"] as const) {
		const app = createApiApp(mode);
		for (const route of app.routes) {
			// `ALL` entries are middleware (cors, auth, rate limits, loggers);
			// every real handler in this app registers a concrete method.
			if (route.method === "ALL") continue;
			const id = routeId(route.method, route.path);
			if (items.has(id)) continue;
			items.set(id, {
				id,
				group: groupFor(route.path),
				plane: planeFor(route.method, route.path),
			});
		}
	}
	return items;
}

async function main(): Promise<void> {
	const items = collectLiveRoutes();

	for (const fixture of DELETED_ROUTE_FIXTURES) {
		const id = routeId(fixture.method, fixture.path);
		if (items.has(id)) {
			console.error(`WARNING: deleted route is live again: ${id}`);
			continue;
		}
		items.set(id, { id, group: groupFor(fixture.path), plane: "deleted" });
	}

	// Manifest fixtures that claim a live surface but were not found in the
	// walked routes — surfaced for the audit, not added as phantom items.
	const liveFixtures = [
		...RETAINED_ROUTE_FIXTURES,
		...RETAINED_METER_ROUTE_FIXTURES,
		...WORKLOAD_ROUTE_FIXTURES,
	];
	const missing = liveFixtures
		.map((f) => routeId(f.method, f.path))
		.filter((id) => !items.has(id));
	for (const id of missing) {
		console.error(`NOTE: manifest fixture not found in walked routes: ${id}`);
	}

	const sorted = [...items.values()].sort((a, b) =>
		a.id.localeCompare(b.id, "en"),
	);

	const outDir = join(import.meta.dir, "out");
	const gitignorePath = join(outDir, ".gitignore");
	const output = {
		surface: "http",
		generatedFrom: [
			"packages/api/src/route-manifest.ts",
			"packages/api/src/create-app.ts (Hono .routes walk, modes: oss, platform)",
		],
		items: sorted,
	};

	await Bun.write(
		join(outDir, "http.json"),
		`${JSON.stringify(output, null, "\t")}\n`,
	);
	if (!existsSync(gitignorePath)) {
		await Bun.write(gitignorePath, "*.json\n");
	}

	const byPlane = new Map<Plane, number>();
	for (const item of sorted)
		byPlane.set(item.plane, (byPlane.get(item.plane) ?? 0) + 1);
	console.log(`wrote ${sorted.length} routes to scripts/parity/out/http.json`);
	for (const [plane, count] of byPlane) console.log(`  ${plane}: ${count}`);
}

await main();
