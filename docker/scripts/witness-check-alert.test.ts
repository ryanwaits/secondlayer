import { afterEach, describe, expect, it } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dir, "witness-check-alert.sh");
const REPO_ROOT = resolve(import.meta.dir, "../..");

const FAKE_PSQL = `#!/bin/bash
echo "\${FAKE_TIP:-100000}"
`;

const FAKE_SHUF = `#!/bin/bash
range=""
count=1
while [ $# -gt 0 ]; do
	case "$1" in
		-i) range="$2"; shift 2 ;;
		-n) count="$2"; shift 2 ;;
		*) shift ;;
	esac
done
lo="\${range%-*}"
i=0
while [ "$i" -lt "$count" ]; do
	echo "$((lo + i))"
	i=$((i + 1))
done
`;

const FAKE_TIMEOUT = `#!/bin/bash
shift
exec "$@"
`;

const FAKE_DOCKER = `#!/bin/bash
cat "$FAKE_RESULTS_FILE"
exit "\${FAKE_DOCKER_EXIT:-0}"
`;

const FAKE_BASE64 = `#!/bin/bash
if [ "\${1:-}" = "-d" ]; then
	exec "$REAL_BUN" -e 'process.stdout.write(Buffer.from((await Bun.stdin.text()).trim(), "base64"))'
fi
exec /usr/bin/base64 "$@"
`;

const FAKE_SLACK_BUN = `#!/bin/bash
shift
msg=$(cat)
printf '%s\\t%s\\n' "$*" "$msg" >> "$SLACK_LOG"
`;

type BlockResult = {
	height: number;
	code: number;
	report: Record<string, unknown>;
};

type SlackPost = {
	flags: string;
	message: string;
};

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function createHarness() {
	const dir = mkdtempSync(join(tmpdir(), "witness-check-alert-"));
	tempDirs.push(dir);
	const binDir = join(dir, "bin");
	const reportDir = join(dir, "reports");
	const stateFile = join(dir, "witness-check.state");
	const slackLog = join(dir, "slack.log");
	const resultsFile = join(dir, "results.txt");
	const slackGate = join(dir, "slack-gate.ts");
	const fakeBun = join(dir, "fake-bun");

	const makeBin = (path: string, body: string) => {
		writeFileSync(path, body);
		chmodSync(path, 0o755);
	};

	Bun.spawnSync(["mkdir", "-p", binDir]);
	for (const [name, body] of [
		["psql", FAKE_PSQL],
		["shuf", FAKE_SHUF],
		["timeout", FAKE_TIMEOUT],
		["docker", FAKE_DOCKER],
		["base64", FAKE_BASE64],
	] as const) {
		makeBin(join(binDir, name), body);
	}
	makeBin(fakeBun, FAKE_SLACK_BUN);
	writeFileSync(slackGate, "");

	const run = (
		results: BlockResult[],
		opts: { dockerExit?: number; sample?: number } = {},
	) => {
		const lines = results.map((r) => {
			const encoded = Buffer.from(JSON.stringify(r.report)).toString("base64");
			return `RESULT ${r.height} ${r.code} ${encoded}`;
		});
		writeFileSync(resultsFile, `${lines.join("\n")}\n`);

		const proc = Bun.spawnSync(["bash", SCRIPT], {
			env: {
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
				HOME: dir,
				REPO_ROOT,
				OPS_CHECK_API_KEY: "sk-sl_test_ops_key",
				SOURCE_DATABASE_URL: "postgresql://localhost/test",
				SLACK_WEBHOOK_URL: "https://hooks.slack.test/services/T/B/X",
				BUN_BIN: fakeBun,
				SLACK_GATE: slackGate,
				SLACK_LOG: slackLog,
				REAL_BUN: process.execPath,
				FAKE_RESULTS_FILE: resultsFile,
				FAKE_DOCKER_EXIT: String(opts.dockerExit ?? 0),
				WITNESS_CHECK_SAMPLE: String(opts.sample ?? results.length),
				WITNESS_CHECK_STATE_FILE: stateFile,
				WITNESS_CHECK_REPORT_DIR: reportDir,
			},
		});

		return {
			code: proc.exitCode,
			out: proc.stdout.toString() + proc.stderr.toString(),
		};
	};

	const slackPosts = (): SlackPost[] => {
		if (!existsSync(slackLog)) return [];
		return readFileSync(slackLog, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const tab = line.indexOf("\t");
				return {
					flags: tab === -1 ? "" : line.slice(0, tab),
					message: tab === -1 ? line : line.slice(tab + 1),
				};
			});
	};

	const state = () =>
		existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : null;

	const reports = () =>
		existsSync(reportDir)
			? readdirSync(reportDir)
					.filter((f) => f.endsWith(".json"))
					.sort()
					.map((f) => ({
						file: f,
						body: JSON.parse(readFileSync(join(reportDir, f), "utf8")),
					}))
			: [];

	return { dir, stateFile, reportDir, run, slackPosts, state, reports };
}

describe("witness-check-alert.sh", () => {
	it("exits 0, writes reports, and posts no Slack alert when all sampled blocks are proven", () => {
		const h = createHarness();
		const res = h.run([
			{ height: 90001, code: 0, report: { ok: true, height: 90001 } },
			{ height: 50001, code: 0, report: { ok: true, height: 50001 } },
		]);

		expect(res.code).toBe(0);
		expect(h.state()).toBeNull();
		expect(h.slackPosts()).toEqual([]);
		expect(h.reports().map((r) => r.body)).toEqual([
			{ ok: true, height: 50001 },
			{ ok: true, height: 90001 },
		]);
	});

	it("exits 1, writes broken state, posts --force alert, and dedupes consecutive broken runs", () => {
		const h = createHarness();
		const first = h.run([
			{ height: 90001, code: 0, report: { ok: true, height: 90001 } },
			{ height: 50001, code: 1, report: { ok: false, height: 50001 } },
		]);

		expect(first.code).toBe(1);
		expect(h.state()).toBe("broken");
		expect(h.slackPosts()).toHaveLength(1);
		expect(h.slackPosts()[0]?.flags).toBe("--force");
		expect(h.slackPosts()[0]?.message).toContain("50001");
		expect(h.slackPosts()[0]?.message).toContain("FAILED verification");

		const second = h.run([
			{ height: 90002, code: 1, report: { ok: false, height: 90002 } },
			{ height: 50002, code: 0, report: { ok: true, height: 50002 } },
		]);

		expect(second.code).toBe(1);
		expect(h.state()).toBe("broken");
		expect(h.slackPosts()).toHaveLength(1);
	});

	it("exits 2, writes unchecked state, posts alert, and dedupes when no block can be checked", () => {
		const h = createHarness();
		const first = h.run(
			[
				{ height: 90001, code: 2, report: { error: "timeout" } },
				{ height: 50001, code: 2, report: { error: "timeout" } },
			],
			{ dockerExit: 0 },
		);

		expect(first.code).toBe(2);
		expect(h.state()).toBe("unchecked");
		expect(h.slackPosts()).toHaveLength(1);
		expect(h.slackPosts()[0]?.flags).toBe("");
		expect(h.slackPosts()[0]?.message).toContain("no block could be checked");

		const second = h.run([
			{ height: 90002, code: 2, report: { error: "timeout" } },
			{ height: 50002, code: 2, report: { error: "timeout" } },
		]);

		expect(second.code).toBe(2);
		expect(h.state()).toBe("unchecked");
		expect(h.slackPosts()).toHaveLength(1);
	});

	for (const priorState of ["broken", "unchecked"] as const) {
		it(`recovers from ${priorState} state: exits 0, removes state file, and posts --recovery`, () => {
			const h = createHarness();
			writeFileSync(h.stateFile, `${priorState}\n`);

			const res = h.run([
				{ height: 90001, code: 0, report: { ok: true, height: 90001 } },
				{ height: 50001, code: 0, report: { ok: true, height: 50001 } },
			]);

			expect(res.code).toBe(0);
			expect(h.state()).toBeNull();
			expect(existsSync(h.stateFile)).toBe(false);
			expect(h.slackPosts()).toHaveLength(1);
			expect(h.slackPosts()[0]?.flags).toBe("--recovery");
			expect(h.slackPosts()[0]?.message).toContain("recovered: 2/2");
		});
	}
});
