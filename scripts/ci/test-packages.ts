/**
 * Runs every package's test suite, up to four at once, each against its own
 * database cloned from the migrated one `DATABASE_URL` names.
 *
 *   bun scripts/ci/test-packages.ts            # every package with a test script
 *   bun scripts/ci/test-packages.ts cli api    # just these
 *
 * One database per package keeps suites from racing on shared rows. Clones
 * are named `<template>_t_<pkg>_<pid>` so runs from several worktrees can
 * share one Postgres. `CREATE DATABASE … TEMPLATE` refuses while anything is
 * connected to the template, so this script only ever connects to the
 * `postgres` admin database, and the migrate step must have exited first.
 */
import { readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";

const ROOT = resolve(import.meta.dir, "../..");

/** Slowest suites first, so the longest one never starts last. */
const LONGEST_FIRST = ["subgraphs", "cli", "shared", "api", "indexer"];

/** Package dirs under `packages/` that declare a `test` script. */
export function discoverPackages(root: string): string[] {
	const dir = join(root, "packages");
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => {
			try {
				const pkg = JSON.parse(
					readFileSync(join(dir, name, "package.json"), "utf8"),
				);
				return typeof pkg.scripts?.test === "string";
			} catch {
				return false;
			}
		})
		.sort();
}

/** Names the caller asked for, checked against what exists. */
export function selectPackages(available: string[], requested: string[]) {
	if (requested.length === 0) return available;
	const unknown = requested.filter((name) => !available.includes(name));
	if (unknown.length > 0)
		throw new Error(`no package with a test script: ${unknown.join(", ")}`);
	return requested;
}

/** Known-slow packages in their fixed order, then the rest alphabetically. */
export function orderPackages(names: string[]): string[] {
	const rank = (name: string) => {
		const index = LONGEST_FIRST.indexOf(name);
		return index === -1 ? LONGEST_FIRST.length : index;
	};
	return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function cloneName(template: string, pkg: string, pid: number): string {
	const name = `${template}_t_${pkg}_${pid}`;
	if (name.length > 63)
		throw new Error(`database name over Postgres' 63-byte limit: ${name}`);
	return name;
}

/** The same server URL pointed at another database. */
export function withDatabase(url: string, database: string): string {
	const next = new URL(url);
	next.pathname = `/${database}`;
	return next.toString();
}

export function templateName(url: string): string {
	const name = decodeURIComponent(new URL(url).pathname.slice(1));
	if (!name) throw new Error(`DATABASE_URL names no database: ${url}`);
	return name;
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

type Result = { pkg: string; ok: boolean; seconds: number };

async function runPackage(
	pkg: string,
	databaseUrl: string,
	children: Set<Bun.Subprocess>,
): Promise<Result> {
	const started = performance.now();
	const child = Bun.spawn(["bun", "run", "test"], {
		cwd: join(ROOT, "packages", pkg),
		env: { ...process.env, DATABASE_URL: databaseUrl },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	children.add(child);
	// One buffer in arrival order, so stdout and stderr stay interleaved.
	const chunks: Uint8Array[] = [];
	const drain = async (stream: ReadableStream<Uint8Array>) => {
		for await (const chunk of stream) chunks.push(chunk);
	};
	await Promise.all([drain(child.stdout), drain(child.stderr), child.exited]);
	children.delete(child);
	const ok = child.exitCode === 0;
	const seconds = (performance.now() - started) / 1000;
	process.stdout.write(
		`\n── ${pkg} ${ok ? "pass" : "FAIL"} ${seconds.toFixed(1)}s\n`,
	);
	for (const chunk of chunks) process.stdout.write(chunk);
	return { pkg, ok, seconds };
}

function printSummary(results: Result[], wallSeconds: number) {
	const width = Math.max(...results.map((r) => r.pkg.length), "package".length);
	console.log(`\n${"package".padEnd(width)}  result  seconds`);
	for (const r of [...results].sort((a, b) => b.seconds - a.seconds))
		console.log(
			`${r.pkg.padEnd(width)}  ${(r.ok ? "pass" : "FAIL").padEnd(6)}  ${r.seconds.toFixed(1).padStart(7)}`,
		);
	console.log(
		`${"wall".padEnd(width)}          ${wallSeconds.toFixed(1).padStart(7)}`,
	);
}

async function main(): Promise<number> {
	const templateUrl = process.env.DATABASE_URL;
	if (!templateUrl) {
		console.error("DATABASE_URL must name the migrated template database");
		return 1;
	}
	const template = templateName(templateUrl);
	const packages = orderPackages(
		selectPackages(discoverPackages(ROOT), process.argv.slice(2)),
	);
	const concurrency = Math.min(4, availableParallelism());
	const admin = new SQL(withDatabase(templateUrl, "postgres"), { max: 1 });
	const clones: string[] = [];
	const children = new Set<Bun.Subprocess>();
	let interrupted = false;
	const onSignal = () => {
		interrupted = true;
		for (const child of children) child.kill();
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);

	const started = performance.now();
	const results: Result[] = [];
	const queue = [...packages];
	const worker = async () => {
		for (let pkg = queue.shift(); pkg && !interrupted; pkg = queue.shift()) {
			const clone = cloneName(template, pkg, process.pid);
			await admin.unsafe(
				`CREATE DATABASE ${quote(clone)} TEMPLATE ${quote(template)}`,
			);
			clones.push(clone);
			if (interrupted) break;
			results.push(
				await runPackage(pkg, withDatabase(templateUrl, clone), children),
			);
		}
	};
	try {
		// Settle every worker before cleanup so no clone is created after the drops.
		const outcomes = await Promise.allSettled(
			Array.from({ length: concurrency }, () =>
				worker().catch((error) => {
					onSignal();
					throw error;
				}),
			),
		);
		const failure = outcomes.find((o) => o.status === "rejected");
		if (failure) throw failure.reason;
	} finally {
		// FORCE ends connections a suite left behind (PG 13+).
		for (const clone of clones)
			await admin
				.unsafe(`DROP DATABASE IF EXISTS ${quote(clone)} WITH (FORCE)`)
				.catch((error) =>
					console.error(`could not drop ${clone}: ${error.message}`),
				);
		await admin.close();
	}

	printSummary(results, (performance.now() - started) / 1000);
	if (interrupted) return 130;
	const failed = results.filter((r) => !r.ok).map((r) => r.pkg);
	if (failed.length > 0) console.log(`\nfailed: ${failed.join(", ")}`);
	return failed.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
