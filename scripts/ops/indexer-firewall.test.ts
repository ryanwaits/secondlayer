import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "docker/scripts/firewall-indexer.sh");
const TESTNET_COMPOSE = join(ROOT, "docker/hosts/testnet/docker-compose.yml");

const IPTABLES = `#!/bin/bash
echo "$*" >> "$IPT_LOG"
case "$1" in
  -D) exit 0 ;;
  -I) exit "\${INSERT_EXIT:-0}" ;;
  -C) exit "\${CHECK_EXIT:-0}" ;;
esac
exit 0
`;

function run(env: Record<string, string> = {}) {
	const dir = mkdtempSync(join(tmpdir(), "indexer-firewall-"));
	const stub = join(dir, "iptables");
	writeFileSync(stub, IPTABLES);
	chmodSync(stub, 0o755);
	const log = join(dir, "iptables.log");
	writeFileSync(log, "");
	const result = Bun.spawnSync(["bash", SCRIPT], {
		env: {
			PATH: `${dir}:${process.env.PATH}`,
			IPT_LOG: log,
			...env,
		},
	});
	return {
		code: result.exitCode,
		stderr: result.stderr.toString(),
		log: readFileSync(log, "utf8").split("\n"),
	};
}

describe("firewall-indexer.sh", () => {
	it("restricts the ingest port to the node IP derived from STACKS_NODE_RPC_URL", () => {
		const r = run({ STACKS_NODE_RPC_URL: "http://10.1.2.3:20443" });
		expect(r.code).toBe(0);
		expect(r.log).toContain(
			"-I DOCKER-USER 1 -p tcp --dport 3700 -s 10.1.2.3 -j RETURN",
		);
		expect(r.log).toContain("-I DOCKER-USER 3 -p tcp --dport 3700 -j DROP");
	});

	it("takes the port from a publish spec with a bind address", () => {
		const r = run({ INDEXER_PORT: "0.0.0.0:3700" });
		expect(r.code).toBe(0);
		expect(r.log).toContain("-I DOCKER-USER 3 -p tcp --dport 3700 -j DROP");
	});

	it("fails when a rule is missing after insert", () => {
		const r = run({ CHECK_EXIT: "1" });
		expect(r.code).toBe(1);
		expect(r.stderr).toContain("rule missing");
	});

	it("fails when an insert fails", () => {
		const r = run({ INSERT_EXIT: "1" });
		expect(r.code).toBe(1);
	});

	it("testnet ingest is covered by the same rule", () => {
		const compose = readFileSync(TESTNET_COMPOSE, "utf8");
		// The single allow rule admits one node host. If the testnet node moves,
		// the allowlist must grow, and this test is what notices.
		expect(compose).toContain('"3701:3700"');
		const testnetHost = compose.match(
			/STACKS_NODE_RPC_URL:\s*https?:\/\/([^:/\s]+)/,
		)?.[1];
		const fallback = readFileSync(SCRIPT, "utf8").match(
			/NODE_IP="\$\{NODE_IP:-([0-9.]+)\}"/,
		)?.[1];
		expect(testnetHost).toBeDefined();
		expect(testnetHost).toBe(fallback);
	});
});
