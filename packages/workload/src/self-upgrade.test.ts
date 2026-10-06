import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(
	import.meta.dir,
	"../../../docker/workload-host/workload-self-upgrade.sh",
);

const GIT_ENV = {
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
};

async function sh(
	cmd: string[],
	cwd: string,
	env: Record<string, string> = {},
) {
	const proc = Bun.spawn(cmd, {
		cwd,
		env: { ...process.env, ...GIT_ENV, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout: stdout.trim(), stderr: stderr.trim(), code };
}

describe("workload-self-upgrade.sh", () => {
	let root: string;
	let origin: string;
	let seed: string;
	let checkout: string;
	let stateDir: string;
	let shimDir: string;
	let callLog: string;
	let server: ReturnType<typeof Bun.serve>;
	// What app-server's /health reports as the deployed sha.
	let deployedSha: string;
	// Target sha for which the freshly restarted service never turns healthy.
	let brokenSha: string | null;
	let baseSha: string;

	const git = (cwd: string, ...args: string[]) => sh(["git", ...args], cwd);

	async function commitFile(path: string, content: string): Promise<string> {
		mkdirSync(join(seed, path, ".."), { recursive: true });
		writeFileSync(join(seed, path), content);
		await git(seed, "add", path);
		await git(seed, "commit", "-q", "-m", `change ${path}`);
		await git(seed, "push", "-q", "origin", "HEAD:main");
		return (await git(seed, "rev-parse", "HEAD")).stdout;
	}

	function run() {
		return sh(["bash", SCRIPT], checkout, {
			PATH: `${shimDir}:${process.env.PATH}`,
			WORKLOAD_CHECKOUT_DIR: checkout,
			WORKLOAD_ENV_FILE: join(root, "absent.env"),
			WORKLOAD_STATE_DIR: stateDir,
			WORKLOAD_UPGRADE_LOCK: join(root, "upgrade.lock"),
			WORKLOAD_HEALTH_URL: `http://127.0.0.1:${server.port}/healthz`,
			WORKLOAD_HEALTH_TIMEOUT: "2",
			APP_SERVER_URL: `http://127.0.0.1:${server.port}`,
		});
	}

	const head = async () => (await git(checkout, "rev-parse", "HEAD")).stdout;
	const calls = () =>
		existsSync(callLog) ? readFileSync(callLog, "utf8").trim().split("\n") : [];
	const restarts = () =>
		calls().filter((c) => c === "systemctl restart secondlayer-workload");

	beforeAll(async () => {
		root = mkdtempSync(join(tmpdir(), "workload-self-upgrade-"));
		// The fake service reports the checkout's HEAD, as a restarted process
		// would, unless that sha is the one marked broken.
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: async (req) => {
				const path = new URL(req.url).pathname;
				if (path === "/health") {
					return Response.json({ status: "ok", image_sha: deployedSha });
				}
				if (path === "/healthz") {
					const sha = (await git(checkout, "rev-parse", "HEAD")).stdout;
					if (sha === brokenSha) return new Response("down", { status: 503 });
					return Response.json({ status: "ok", sha });
				}
				return new Response("not found", { status: 404 });
			},
		});
	});

	afterAll(() => {
		server.stop(true);
		rmSync(root, { recursive: true, force: true });
	});

	beforeEach(async () => {
		// Fresh origin + seed + checkout per test, all at one base commit.
		for (const d of ["origin.git", "seed", "checkout", "state", "shims"]) {
			rmSync(join(root, d), { recursive: true, force: true });
		}
		origin = join(root, "origin.git");
		seed = join(root, "seed");
		checkout = join(root, "checkout");
		stateDir = join(root, "state");
		shimDir = join(root, "shims");
		callLog = join(root, "calls.log");
		rmSync(callLog, { force: true });
		brokenSha = null;

		mkdirSync(origin);
		await git(origin, "init", "-q", "--bare", "-b", "main");
		mkdirSync(seed);
		await git(seed, "init", "-q", "-b", "main");
		await git(seed, "remote", "add", "origin", origin);
		baseSha = await commitFile("packages/workload/base.txt", "base");
		await git(root, "clone", "-q", origin, checkout);
		deployedSha = baseSha;

		mkdirSync(shimDir);
		// flock/systemctl/bun are shimmed: no flock locally, and nothing here may
		// touch a real service or toolchain.
		const shims: Record<string, string> = {
			flock: "exit 0",
			systemctl: `echo "systemctl $*" >> "${callLog}"`,
			bun: `echo "bun $*" >> "${callLog}"`,
		};
		for (const [name, body] of Object.entries(shims)) {
			const p = join(shimDir, name);
			writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
			chmodSync(p, 0o755);
		}
	});

	test("target equal to the running sha is a no-op", async () => {
		const res = await run();
		expect(res.code).toBe(0);
		expect(await head()).toBe(baseSha);
		expect(calls()).toEqual([]);
	});

	test("a change outside the service's paths moves HEAD without a restart", async () => {
		deployedSha = await commitFile("apps/web/page.txt", "x");
		const res = await run();
		expect(res.code).toBe(0);
		expect(await head()).toBe(deployedSha);
		expect(restarts()).toHaveLength(0);
		expect(calls().some((c) => c.startsWith("bun "))).toBe(false);
	});

	test("a relevant change installs, builds, restarts, and ends on the new sha", async () => {
		deployedSha = await commitFile("packages/workload/new.txt", "x");
		const res = await run();
		expect(res.code).toBe(0);
		expect(await head()).toBe(deployedSha);
		expect(calls()).toEqual([
			"bun install --frozen-lockfile",
			"bun run build:stacks",
			"bun run build:shared",
			"bun run build:platform",
			"systemctl restart secondlayer-workload",
		]);
		expect(existsSync(join(stateDir, "bad-sha"))).toBe(false);
	});

	test("an unhealthy new service rolls back, records the bad sha, and the next run skips it", async () => {
		deployedSha = await commitFile("packages/workload/broken.txt", "x");
		brokenSha = deployedSha;

		const res = await run();
		expect(res.code).toBe(1);
		expect(res.stdout).toContain(
			`workload-self-upgrade: ROLLED BACK ${deployedSha} -> ${baseSha}`,
		);
		expect(await head()).toBe(baseSha);
		expect(readFileSync(join(stateDir, "bad-sha"), "utf8").trim()).toBe(
			deployedSha,
		);
		// One restart for the upgrade, one for the rollback.
		expect(restarts()).toHaveLength(2);

		const again = await run();
		expect(again.code).toBe(0);
		expect(again.stdout).toContain("previously failed");
		expect(await head()).toBe(baseSha);
		expect(restarts()).toHaveLength(2);
	});

	test("a newer deployed sha is attempted even after an earlier one was marked bad", async () => {
		deployedSha = await commitFile("packages/workload/broken.txt", "x");
		brokenSha = deployedSha;
		await run();

		deployedSha = await commitFile("packages/workload/fixed.txt", "y");
		brokenSha = null;
		const res = await run();
		expect(res.code).toBe(0);
		expect(await head()).toBe(deployedSha);
		expect(existsSync(join(stateDir, "bad-sha"))).toBe(false);
	});

	test("a dirty checkout is refused and left untouched", async () => {
		deployedSha = await commitFile("packages/workload/new.txt", "x");
		writeFileSync(join(checkout, "local-edit.txt"), "hand edit");

		const res = await run();
		expect(res.code).toBe(1);
		expect(res.stdout).toContain("local changes");
		expect(await head()).toBe(baseSha);
		expect(calls()).toEqual([]);
	});

	test("an invalid target is a no-op", async () => {
		deployedSha = "not-a-sha";
		const res = await run();
		expect(res.code).toBe(0);
		expect(await head()).toBe(baseSha);
		expect(calls()).toEqual([]);
	});

	test("a well-formed target that does not exist in the repo is a no-op", async () => {
		deployedSha = "d".repeat(40);
		const res = await run();
		expect(res.code).toBe(0);
		expect(res.stdout).toContain("not found after fetch");
		expect(await head()).toBe(baseSha);
		expect(calls()).toEqual([]);
	});
});
