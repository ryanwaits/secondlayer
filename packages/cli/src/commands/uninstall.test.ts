import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planUninstall } from "@secondlayer/shared/runtime";
import {
	UNINSTALL_EXIT,
	composeDownArgs,
	resolveUninstallLayout,
} from "./uninstall.ts";

const CLI_ENTRY = join(import.meta.dir, "../cli.ts");

function setupDir(): string {
	// realpath: the CLI reports paths from process.cwd(), which macOS resolves
	// past the /var -> /private/var symlink that mkdtemp hands back.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sl-uninstall-")));
	writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
	writeFileSync(
		join(dir, ".env"),
		`POSTGRES_PASSWORD=pw\nSECONDLAYER_SECRETS_KEY=${"a".repeat(64)}\n`,
	);
	return dir;
}

function runCli(cwd: string, args: string[]) {
	return spawnSync(process.execPath, [CLI_ENTRY, "uninstall", ...args], {
		cwd,
		encoding: "utf8",
		env: {
			...process.env,
			NO_COLOR: "1",
			SECONDLAYER_SECRETS_KEY: "",
			DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
		},
	});
}

describe("uninstall finds the stack secondlayer setup wrote", () => {
	test("defaults to ./docker-compose.yml with --env-file ./.env, and knows where the keys are", () => {
		const dir = setupDir();
		const layout = resolveUninstallLayout(dir);
		expect(layout.composeFile).toBe(join(dir, "docker-compose.yml"));
		expect(layout.envFile).toBe(join(dir, ".env"));
		expect(layout.secretsFile).toBe(join(dir, ".env"));

		const plan = planUninstall({
			purge: false,
			confirmed: false,
			keysBackedUp: false,
			secretsPresent: true,
			dataDir: "./data",
		});
		if (!plan.ok) throw new Error(plan.reason);
		expect(composeDownArgs(plan.plan, layout)).toEqual([
			"compose",
			"-f",
			join(dir, "docker-compose.yml"),
			"--env-file",
			join(dir, ".env"),
			"down",
			"--remove-orphans",
		]);
	});

	test("falls back to the repo compose file and .env.local for a hand-run checkout", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-uninstall-repo-"));
		writeFileSync(
			join(dir, ".env.local"),
			`SECONDLAYER_SECRETS_KEY=${"b".repeat(64)}\n`,
		);
		const layout = resolveUninstallLayout(dir);
		expect(layout.composeFile).toBe(join(dir, "docker/oss/docker-compose.yml"));
		expect(layout.envFile).toBeUndefined();
		expect(layout.secretsFile).toBe(join(dir, ".env.local"));
	});

	test("an env file with no secrets key still counts as keys present for the purge guard", () => {
		const dir = mkdtempSync(join(tmpdir(), "sl-uninstall-nokey-"));
		writeFileSync(join(dir, ".env.local"), "INSTANCE_TOKEN=tok\n");
		const layout = resolveUninstallLayout(dir);
		expect(layout.secretsFile).toBe(join(dir, ".env.local"));
	});

	test("--purge --yes in a setup directory still refuses without --backup, naming the .env that holds the keys", () => {
		const dir = setupDir();
		const res = runCli(dir, ["--purge", "--yes", "--apply"]);
		expect(res.status).toBe(UNINSTALL_EXIT.REFUSED);
		expect(res.stderr).toContain("refusing to purge");
		expect(res.stderr).toContain(join(dir, ".env"));
	});

	test("the dry run reports the compose file, env file, and keys file it found", () => {
		const dir = setupDir();
		const res = runCli(dir, ["--json"]);
		expect(res.status).toBe(0);
		const report = JSON.parse(res.stdout) as {
			dryRun: boolean;
			command: string[];
			composeFile: string;
			envFile: string | null;
			secretsFile: string | null;
		};
		expect(report.dryRun).toBe(true);
		expect(report.composeFile).toBe(join(dir, "docker-compose.yml"));
		expect(report.envFile).toBe(join(dir, ".env"));
		expect(report.secretsFile).toBe(join(dir, ".env"));
		expect(report.command).toContain("--env-file");
	});
});
