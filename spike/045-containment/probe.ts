import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Socket } from "node:net";
import { defineSubgraph } from "@secondlayer/subgraphs";

/**
 * Containment probe subgraph. Deployed into a tenant stack under hardening.
 * `runChecks()` runs at module top level, so it fires wherever the module is
 * import()ed: the api's deploy-time empty-mapping probe ("deploy-probe") and
 * the processor's startup load ("processor"). The handler also calls it, but
 * only fires when a matching block arrives (never in the scratch stack).
 *
 * One JSON line per check on stdout. Every check is a single read or a single
 * TCP connect with a 1s timeout, no payload sent. Never prints an env value,
 * only key names.
 */

type Path = "deploy-probe" | "processor" | "unknown";
type At = "module" | "handler";

const TIMEOUT_MS = 1000;
const MB = 1024 * 1024;

function detectPath(): Path {
	const main: string =
		(globalThis as { Bun?: { main?: string } }).Bun?.main ??
		process.argv[1] ??
		"";
	if (/subgraphs\/src\/service/.test(main)) return "processor";
	if (/packages\/api\//.test(main)) return "deploy-probe";
	return "unknown";
}

const PATH = detectPath();

function emit(
	at: At,
	check: string,
	expected: string,
	outcome: string,
	detail: string,
) {
	console.log(
		JSON.stringify({ check, expected, outcome, detail, path: PATH, at }),
	);
}

type TcpState = "reachable" | "blocked" | "refused" | "error";

/** One connect, no payload. Timeout and unreachable = blocked; RST = refused
 *  (a packet reached something, so it is NOT counted as firewall-blocked). */
function tcp(
	host: string,
	port: number,
): Promise<{ state: TcpState; detail: string }> {
	return new Promise((resolve) => {
		const sock = new Socket();
		let done = false;
		const finish = (state: TcpState, detail: string) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			sock.destroy();
			resolve({ state, detail });
		};
		const timer = setTimeout(() => finish("blocked", "ETIMEDOUT"), TIMEOUT_MS);
		sock.once("connect", () => finish("reachable", "connected"));
		sock.once("error", (err: NodeJS.ErrnoException) => {
			const code = err.code ?? "ERR";
			if (code === "ECONNREFUSED") return finish("refused", code);
			if (["EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "EACCES"].includes(code))
				return finish("blocked", code);
			finish("error", code);
		});
		try {
			sock.connect(port, host);
		} catch (err) {
			finish("error", err instanceof Error ? err.message : String(err));
		}
	});
}

async function tcpCheck(
	at: At,
	check: string,
	host: string,
	port: number,
	expected: "blocked" | "reachable",
) {
	const r = await tcp(host, port);
	emit(at, check, expected, r.state, `${host}:${port} ${r.detail}`);
}

function gatewayFromRoute(): string | null {
	try {
		const lines = readFileSync("/proc/net/route", "utf8").trim().split("\n");
		for (const line of lines.slice(1)) {
			const f = line.split(/\s+/);
			if (f[1] === "00000000" && f[2]) {
				const n = Number.parseInt(f[2], 16);
				return [
					n & 255,
					(n >> 8) & 255,
					(n >> 16) & 255,
					(n >>> 24) & 255,
				].join(".");
			}
		}
	} catch {}
	return null;
}

// Files Docker itself bind-mounts into every container. Not declared volumes,
// but not a host path either; listed separately in the detail field.
const DOCKER_MANAGED = new Set([
	"/etc/hosts",
	"/etc/hostname",
	"/etc/resolv.conf",
]);
function mountAllowed(target: string): boolean {
	return (
		target === "/" ||
		target === "/tmp" ||
		target === "/proc" ||
		target.startsWith("/proc/") ||
		target === "/sys" ||
		target.startsWith("/sys/") ||
		target === "/dev" ||
		target.startsWith("/dev/") ||
		target === "/data/subgraphs"
	);
}

async function baseChecks(at: At) {
	// env:pid1 - key names only, never values.
	try {
		const raw = readFileSync("/proc/1/environ", "utf8");
		const pid1 = raw
			.split("\0")
			.filter(Boolean)
			.map((kv) => kv.slice(0, kv.indexOf("=")))
			.sort();
		const own = new Set(Object.keys(process.env));
		const foreign = pid1.filter((k) => !own.has(k));
		emit(
			at,
			"env:pid1",
			"own-only",
			foreign.length === 0 ? "own-only" : `foreign:${foreign.join(",")}`,
			`keys=${pid1.join(",")}`,
		);
	} catch (err) {
		emit(
			at,
			"env:pid1",
			"own-only",
			"unreadable",
			(err as NodeJS.ErrnoException).code ?? String(err),
		);
	}

	emit(
		at,
		"fs:docker-sock",
		"false",
		String(existsSync("/var/run/docker.sock")),
		"/var/run/docker.sock",
	);

	try {
		const targets = readFileSync("/proc/self/mounts", "utf8")
			.trim()
			.split("\n")
			.map((l) => l.split(" ")[1] ?? "");
		const extra = targets.filter(
			(t) => !mountAllowed(t) && !DOCKER_MANAGED.has(t),
		);
		const managed = targets.filter((t) => DOCKER_MANAGED.has(t));
		emit(
			at,
			"fs:mounts",
			"declared-only",
			extra.length === 0 ? "declared-only" : `extra:${extra.join(",")}`,
			`docker-managed=${managed.join(",") || "none"} all=${targets.join(",")}`,
		);
	} catch (err) {
		emit(at, "fs:mounts", "declared-only", "unreadable", String(err));
	}

	try {
		writeFileSync("/probe.txt", "x");
		try {
			unlinkSync("/probe.txt");
		} catch {}
		emit(at, "fs:write-root", "blocked", "writable", "/probe.txt written");
	} catch (err) {
		emit(
			at,
			"fs:write-root",
			"blocked",
			"blocked",
			(err as NodeJS.ErrnoException).code ?? String(err),
		);
	}

	const gateway = process.env.PROBE_GATEWAY_IP || gatewayFromRoute();
	const bPgIp = process.env.PROBE_B_PG_IP;
	const bApiPort = Number(process.env.PROBE_B_API_PORT ?? 0);
	const jobs: Promise<void>[] = [
		tcpCheck(at, "tcp:own-postgres", "postgres", 5432, "reachable"),
		tcpCheck(at, "tcp:metadata", "169.254.169.254", 80, "blocked"),
		tcpCheck(at, "tcp:rfc1918:10.0.0.2", "10.0.0.2", 443, "blocked"),
		tcpCheck(at, "tcp:rfc1918:172.16.0.1", "172.16.0.1", 443, "blocked"),
		tcpCheck(at, "tcp:rfc1918:192.168.0.1", "192.168.0.1", 443, "blocked"),
		tcpCheck(at, "tcp:public-api", "api.secondlayer.tools", 443, "reachable"),
		(async () => {
			try {
				const r = await Promise.race([
					lookup("tenant-b-postgres-1"),
					new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(Object.assign(new Error("t"), { code: "TIMEOUT" })),
							TIMEOUT_MS,
						),
					),
				]);
				emit(
					at,
					"dns:other-tenant",
					"not-found",
					"resolved",
					String(r.address),
				);
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code ?? "ERR";
				emit(
					at,
					"dns:other-tenant",
					"not-found",
					code === "ENOTFOUND" ? "not-found" : `error:${code}`,
					code,
				);
			}
		})(),
	];
	if (bPgIp)
		jobs.push(
			tcpCheck(at, "tcp:other-tenant-postgres", bPgIp, 5432, "blocked"),
		);
	else
		emit(
			at,
			"tcp:other-tenant-postgres",
			"blocked",
			"error",
			"PROBE_B_PG_IP unset",
		);
	if (gateway) {
		if (bApiPort)
			jobs.push(
				tcpCheck(at, "tcp:other-tenant-api", gateway, bApiPort, "blocked"),
			);
		else
			emit(
				at,
				"tcp:other-tenant-api",
				"blocked",
				"error",
				"PROBE_B_API_PORT unset",
			);
		jobs.push(tcpCheck(at, "tcp:host-gateway", gateway, 8080, "blocked"));
		jobs.push(tcpCheck(at, "tcp:control-pg", gateway, 5432, "blocked"));
	} else {
		for (const c of [
			"tcp:other-tenant-api",
			"tcp:host-gateway",
			"tcp:control-pg",
		])
			emit(at, c, "blocked", "error", "gateway ip unknown");
	}
	await Promise.all(jobs);
}

async function resPids(at: At) {
	const kids: ReturnType<typeof spawn>[] = [];
	let stopReason = "cap-400";
	for (let i = 0; i < 400; i++) {
		try {
			const kid = spawn("sleep", ["30"], { stdio: "ignore" });
			let failed = false;
			kid.once("error", (err: NodeJS.ErrnoException) => {
				failed = true;
				stopReason = err.code ?? "error";
			});
			await new Promise((r) => setTimeout(r, 10));
			if (failed || kid.pid === undefined) break;
			kids.push(kid);
		} catch (err) {
			stopReason = (err as NodeJS.ErrnoException).code ?? String(err);
			break;
		}
	}
	emit(
		at,
		"res:pids",
		"stops-near-128",
		`stopped-at-${kids.length}`,
		`reason=${stopReason} pids_limit=128`,
	);
	for (const k of kids) k.kill();
}

async function resMemory(at: At) {
	const held: Buffer[] = [];
	for (let mb = 64; mb <= 2048; mb += 64) {
		held.push(Buffer.alloc(64 * MB, 1));
		emit(at, "res:memory", "oom-killed-near-512MB", "progress", `held=${mb}MB`);
		await new Promise((r) => setTimeout(r, 100));
	}
	emit(
		at,
		"res:memory",
		"oom-killed-near-512MB",
		"survived-2048MB",
		`held=${held.length * 64}MB`,
	);
}

function resCpu(at: At) {
	emit(at, "res:cpu", "other-tenant-keeps-advancing", "start", "busy loop 60s");
	const end = Date.now() + 60_000;
	let n = 0;
	while (Date.now() < end) n++;
	emit(at, "res:cpu", "other-tenant-keeps-advancing", "end", `iterations=${n}`);
}

export async function runChecks(at: At) {
	const res = process.env.PROBE_RES;
	if (res) {
		// Resource checks run one at a time, processor only: they are meant to
		// kill or starve the container, which must not take the deploy API down.
		if (PATH !== "processor" || at !== "module") return;
		if (res === "pids") await resPids(at);
		else if (res === "memory") await resMemory(at);
		else if (res === "cpu") resCpu(at);
		return;
	}
	await baseChecks(at);
}

await runChecks("module");

export default defineSubgraph({
	name: "containment-probe",
	sources: {
		probe: {
			type: "print_event",
			contractId: "SP000000000000000000002Q6VF78.pox-5",
			topic: "containment-probe",
			prints: { "containment-probe": { note: "text" } },
		},
	},
	schema: {
		probe_runs: { columns: { note: { type: "text" } } },
	},
	handlers: {
		probe: async (_event, ctx) => {
			await runChecks("handler");
			ctx.insert("probe_runs", { note: "ran" });
		},
	},
});
