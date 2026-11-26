import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WRAPPER = resolve(import.meta.dir, "remote-rollback-systemd.sh");

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

type Options = {
	doneAfter: number;
	finalStatus?: number;
	timeout: number;
	unit?: string;
};

function run(options: Options) {
	const dir = mkdtempSync(join(tmpdir(), "rollback-wrapper-"));
	for (const [name, body] of [
		["systemd-run", "#!/bin/bash\nexit 0\n"],
		["systemctl", FAKE_SYSTEMCTL],
		["journalctl", "#!/bin/bash\nexit 0\n"],
		["rollback.sh", ""],
	] as const) {
		writeFileSync(join(dir, name), body);
		chmodSync(join(dir, name), 0o755);
	}
	const result = Bun.spawnSync(["bash", WRAPPER], {
		env: {
			PATH: `${dir}:${process.env.PATH ?? ""}`,
			HOME: dir,
			STATE_DIR: dir,
			ROLLBACK_UNIT: options.unit ?? "secondlayer-rollback-test",
			ROLLBACK_SCRIPT: join(dir, "rollback.sh"),
			ROLLBACK_POLL_INTERVAL_SECONDS: "1",
			ROLLBACK_POLL_TIMEOUT_SECONDS: String(options.timeout),
			DONE_AFTER: String(options.doneAfter),
			FINAL_STATUS: String(options.finalStatus ?? 0),
		},
	});
	return {
		code: result.exitCode,
		out: result.stdout.toString() + result.stderr.toString(),
	};
}

setDefaultTimeout(30_000);

describe("remote rollback watcher", () => {
	it("exits 0 when the unit finishes before the timeout", () => {
		const { code, out } = run({ doneAfter: 2, timeout: 10 });
		expect(code).toBe(0);
		expect(out).toContain("completed successfully");
	});

	it("exits 1 and reports the failure when the unit exits non-zero", () => {
		const { code, out } = run({ doneAfter: 1, finalStatus: 75, timeout: 10 });
		expect(code).toBe(1);
		expect(out).toContain("failed");
	});

	it("exits 124 when the unit is still running at the timeout", () => {
		const { code, out } = run({ doneAfter: 9999, timeout: 2 });
		expect(code).toBe(124);
		expect(out).toContain("Timed out");
	});

	it("exits 2 when the unit name has unsupported characters", () => {
		const { code } = run({
			doneAfter: 1,
			timeout: 10,
			unit: "bad name;rm",
		});
		expect(code).toBe(2);
	});
});
