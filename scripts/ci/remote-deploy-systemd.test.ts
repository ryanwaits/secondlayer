import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WRAPPER = resolve(import.meta.dir, "remote-deploy-systemd.sh");

const HOLD_LINE =
	"⏳ secondlayer-archive-publish.service is running — waiting for it to finish before touching indexer...";
const RESUME_LINE =
	"✅ secondlayer-archive-publish.service finished — resuming deploy";

// Fake systemctl: each ActiveState read counts as one poll. Before
// DONE_AFTER polls the unit looks like a running unit (Result=success,
// ExecMainStatus=0, as real systemd prints); after, it has exited with
// FINAL_STATUS.
const FAKE_SYSTEMCTL = `#!/bin/bash
prop=""
for arg in "$@"; do
	case "$arg" in --property=*) prop="\${arg#--property=}" ;; esac
done
n=$(cat "$STATE_DIR/n" 2>/dev/null || echo 0)
if [[ "$prop" == "ActiveState" ]]; then
	n=$((n + 1))
	echo "$n" > "$STATE_DIR/n"
fi
if (( n < DONE_AFTER )); then
	case "$prop" in
		ActiveState) echo active ;;
		SubState) echo running ;;
		Result) echo success ;;
		ExecMainStatus) echo 0 ;;
	esac
else
	case "$prop" in
		ActiveState) echo active ;;
		SubState) echo exited ;;
		Result) echo success ;;
		ExecMainStatus) echo "\${FINAL_STATUS:-0}" ;;
	esac
fi
`;

const FAKE_JOURNALCTL = `#!/bin/bash
n=$(cat "$STATE_DIR/n" 2>/dev/null || echo 0)
if [[ "\${HELD:-0}" == "1" ]]; then
	echo "${HOLD_LINE}"
	if (( n >= RESUME_AFTER )); then
		echo "${RESUME_LINE}"
	fi
fi
exit 0
`;

type Options = {
	held?: boolean;
	resumeAfter?: number;
	doneAfter: number;
	finalStatus?: number;
	timeout: number;
	maxTotal?: number;
};

function run(options: Options) {
	const dir = mkdtempSync(join(tmpdir(), "deploy-wrapper-"));
	for (const [name, body] of [
		["systemd-run", "#!/bin/bash\nexit 0\n"],
		["systemctl", FAKE_SYSTEMCTL],
		["journalctl", FAKE_JOURNALCTL],
		["deploy.sh", ""],
	] as const) {
		writeFileSync(join(dir, name), body);
		chmodSync(join(dir, name), 0o755);
	}
	const result = Bun.spawnSync(["bash", WRAPPER], {
		env: {
			PATH: `${dir}:${process.env.PATH ?? ""}`,
			HOME: dir,
			STATE_DIR: dir,
			DEPLOY_UNIT: "secondlayer-deploy-test",
			DEPLOY_SHA: "abc",
			DEPLOY_SCRIPT: join(dir, "deploy.sh"),
			DEPLOY_POLL_INTERVAL_SECONDS: "1",
			DEPLOY_POLL_TIMEOUT_SECONDS: String(options.timeout),
			DEPLOY_MAX_TOTAL_SECONDS: String(options.maxTotal ?? 19800),
			DEPLOY_JOURNAL_TAIL_INTERVAL_SECONDS: "1",
			DEPLOY_HOLD_NOTE_INTERVAL_SECONDS: "1",
			HELD: options.held ? "1" : "0",
			RESUME_AFTER: String(options.resumeAfter ?? 0),
			DONE_AFTER: String(options.doneAfter),
			FINAL_STATUS: String(options.finalStatus ?? 0),
		},
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString() + result.stderr.toString(),
	};
}

// Each case runs the real wrapper at 1s polls, so give it room.
setDefaultTimeout(30_000);

describe("remote deploy watcher", () => {
	it("exits 0 when the unit finishes before the timeout", () => {
		const { code, out } = run({ doneAfter: 2, timeout: 10 });
		expect(code).toBe(0);
		expect(out).toContain("completed successfully");
	});

	it("exits 124 when the unit is still running at the timeout", () => {
		const { code, out } = run({ doneAfter: 9999, timeout: 2 });
		expect(code).toBe(124);
		expect(out).toContain("Timed out");
	});

	it("keeps waiting past the timeout while the archive publish holds the deploy, then succeeds", () => {
		const { code, out } = run({
			held: true,
			resumeAfter: 6,
			doneAfter: 6,
			timeout: 3,
		});
		expect(code).toBe(0);
		expect(out).toContain("completed successfully");
		expect(out).not.toContain("Timed out");
	});

	it("tells the operator the deploy is held and not failing", () => {
		const { out } = run({
			held: true,
			resumeAfter: 6,
			doneAfter: 6,
			timeout: 3,
		});
		expect(out).toContain("Deploy held by the archive publish");
		expect(out).toContain("Not a failure.");
	});

	it("gives up at the hard cap when the hold never ends", () => {
		const { code, out } = run({
			held: true,
			resumeAfter: 9999,
			doneAfter: 9999,
			timeout: 2,
			maxTotal: 4,
		});
		expect(code).toBe(124);
		expect(out).toContain("Timed out");
		expect(out).toContain("held by the archive publish for");
	});

	it("still reports a failure when the unit fails after a hold", () => {
		const { code, out } = run({
			held: true,
			resumeAfter: 6,
			doneAfter: 6,
			finalStatus: 1,
			timeout: 3,
		});
		expect(code).toBe(1);
		expect(out).toContain("failed");
	});
});
