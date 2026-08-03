import { describe, expect, test } from "bun:test";
// f071 Stage A — the containment proof for the SUBPROCESS substrate.
//
// Modeled on `isolation.test.ts`'s honest style (kept, unmodified, as the
// Worker-substrate regression lock this plan does NOT touch): assert closed
// vectors FAIL to leak, and assert known-open vectors as openly documented
// green tests, not silence. The difference from `isolation.test.ts` is the
// verdict, not the method — same probe shape, same "real subprocess, real
// OS env var, never a JS `process.env` mutation" methodology (the f060
// spike proved a JS mutation doesn't reach a Bun Worker's inherited env;
// the analogous risk here is that a JS mutation wouldn't reach a freshly
// spawned OS process's env either — both harnesses below set
// SECONDLAYER_SECRETS_KEY via `Bun.spawn`'s real `env` option on an actual
// child process).
//
// What this locks in for the subprocess substrate:
//   - bare `process.env.X`        → CLOSED (undefined — real OS-level scrub)
//   - `globalThis.process.env.X`  → CLOSED
//   - `Bun.env.X`                 → CLOSED
//   - `Bun.spawnSync(echo $X)`    → CLOSED (the exact vector that killed the
//                                    Worker substrate — see spike doc §10)
//   - `import("node:child_process")` → BLOCKED (bundle-time resolver
//                                    lockdown, unchanged from Stage 2a)
//   - `Bun.file(path)`            → *** still reads — DOCUMENTED OPEN ***
//   - `/proc/<hostpid>/environ`   → *** still reads on Linux — DOCUMENTED
//                                    OPEN *** (skip-visible off Linux)
// The last two are why Stage A is not full f049 closure — key relocation
// (spike doc D3) is what closes them. See the plan's threat-model-honesty
// section and the doc addendum for the full containment matrix.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_SECRET = "f071fakesecret_subprocess_deadbeef_never_the_real_key";

const CONTAINMENT_HARNESS = `
import { bundleHandlerCode } from ${JSON.stringify(join(HERE, "bundle.ts"))};
import { spawnSandboxProcess } from ${JSON.stringify(join(HERE, "host.ts"))};

// A handler that probes every ambient-authority vector the Worker-substrate
// isolation.test.ts probed, PLUS a same-UID /proc/<ppid>/environ read (the
// sandbox subprocess's direct parent is THIS harness process, which is the
// one holding SECONDLAYER_SECRETS_KEY here — same relationship the real
// pool has to the block-processor host). Results ship home via ctx.insert
// (buffered ops are what blockDone returns).
const PROBE_SOURCE = \`
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "probe",
  sources: { tick: { type: "contract_call" } },
  schema: { probe: { columns: {
    bareEnv: { type: "text", nullable: true },
    globEnv: { type: "text", nullable: true },
    bunEnv: { type: "text", nullable: true },
    bunSpawn: { type: "text", nullable: true },
    bunFile: { type: "text", nullable: true },
    procEnviron: { type: "text", nullable: true },
  } } },
  handlers: {
    tick: async (event, ctx) => {
      const row = {};
      try { row.bareEnv = process.env.SECONDLAYER_SECRETS_KEY ?? "<absent>"; } catch (e) { row.bareEnv = "throw"; }
      try { row.globEnv = (globalThis.process && globalThis.process.env && globalThis.process.env.SECONDLAYER_SECRETS_KEY) || "<absent>"; } catch (e) { row.globEnv = "throw"; }
      try { row.bunEnv = (globalThis.Bun && globalThis.Bun.env && globalThis.Bun.env.SECONDLAYER_SECRETS_KEY) || "<absent>"; } catch (e) { row.bunEnv = "throw"; }
      try {
        const r = globalThis.Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $SECONDLAYER_SECRETS_KEY"] });
        const out = new TextDecoder().decode(r.stdout).trim();
        row.bunSpawn = out || "<empty>";
      } catch (e) { row.bunSpawn = "BLOCKED"; }
      try {
        const canary = "/tmp/f071-subprocess-fs-canary-" + Math.random().toString(36).slice(2);
        globalThis.Bun.write(canary, "CANARY");
        row.bunFile = globalThis.Bun.file(canary).size >= 0 ? "readable" : "no";
      } catch (e) { row.bunFile = "BLOCKED"; }
      try {
        const text = await globalThis.Bun.file("/proc/" + process.ppid + "/environ").text();
        row.procEnviron = text.includes(${JSON.stringify(FAKE_SECRET)}) ? "readable-leaked" : "readable-no-match";
      } catch (e) { row.procEnviron = "BLOCKED-or-unsupported"; }
      ctx.insert("probe", row);
    },
  },
});
\`;

const MATCHED = [{
  sourceName: "tick", events: [],
  tx: { tx_id: "0xsub", type: "contract_call", sender: "SP0", status: "success", tx_index: 0, contract_id: null, function_name: null },
}];
const BLOCK = { height: 1, hash: "0x0", timestamp: 0, burnBlockHeight: 0 };

function runProbe() {
  return new Promise(async (resolve, reject) => {
    const bundled = await bundleHandlerCode(PROBE_SOURCE);
    const proc = spawnSandboxProcess(); // EXACT production spawn (from-scratch env allowlist)
    proc.setOnMessage((msg) => {
      if (msg.type === "ready") { proc.send({ type: "runBlock", block: BLOCK, matched: MATCHED }); return; }
      if (msg.type === "blockDone") { proc.kill(); resolve(msg.ops[0] ? msg.ops[0].args[0] : {}); return; }
      if (msg.type === "error") { proc.kill(); reject(new Error(msg.message)); }
    });
    proc.send({ type: "init", bundledCode: bundled, version: "1" });
  });
}

async function bundleBlocks(source) {
  const bundled = await bundleHandlerCode(source);
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "sub-iso-b-"));
  const file = join(dir, "h.mjs");
  writeFileSync(file, bundled);
  try { await import(pathToFileURL(file).href); return false; } catch { return true; }
}

const probe = await runProbe();
const fsBlocked = await bundleBlocks('import { readFileSync } from "node:fs"; export default { r: readFileSync };');
const cpBlocked = await bundleBlocks('import { execSync } from "node:child_process"; export default { e: execSync };');

const redactSecret = (v) => (v === "<absent>" || v === "<empty>" || v === "BLOCKED") ? v : (v === ${JSON.stringify(FAKE_SECRET)} ? "<leaked-fake>" : "<other>");
console.log(JSON.stringify({
  bareEnv: redactSecret(probe.bareEnv),
  globEnv: redactSecret(probe.globEnv),
  bunEnv: redactSecret(probe.bunEnv),
  bunSpawn: redactSecret(probe.bunSpawn),
  bunFile: probe.bunFile,
  procEnviron: probe.procEnviron,
  fsBlocked, cpBlocked,
  platform: process.platform,
}));
process.exit(0);
`;

// Short deadline (default production is 60s) so the timeout sub-test below
// doesn't make the suite slow — set on the harness's REAL OS env, so
// host.ts's module-level BLOCK_TIMEOUT_MS constant (read once at import)
// picks it up correctly in that fresh process. Never touches this test
// runner's own process/module state.
const SHORT_TIMEOUT_MS = 1500;

const CRASH_HARNESS = `
import { runHandlersSandboxed, shutdownSandboxPool } from ${JSON.stringify(join(HERE, "host.ts"))};

const HANG_SOURCE = \`
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "hang",
  sources: { tick: { type: "contract_call" } },
  schema: {},
  handlers: { tick: () => { while (true) {} } },
});
\`;
const GOOD_SOURCE = \`
import { defineSubgraph } from "@secondlayer/subgraphs";
export default defineSubgraph({
  name: "hang",
  sources: { tick: { type: "contract_call" } },
  schema: {},
  handlers: { tick: () => {} },
});
\`;

function matched(txId) {
  return [{ sourceName: "tick", events: [], tx: { tx_id: txId, type: "contract_call", sender: "SP0", status: "success", tx_index: 0, contract_id: null, function_name: null } }];
}

// hostCtx is never actually touched: the hung handler throws/times out
// before any ctx call, and the good handler makes no ctx calls either (so
// blockDone ships an empty ops array — the host-side replay loop over
// hostCtx never executes). A real SubgraphContext is unnecessary here; this
// test is about the pool's crash/timeout/respawn contract, not the ctx
// membrane (already covered by host-parity.test.ts).
const hostCtx = {};

let hangError = null;
const t0 = Date.now();
try {
  await runHandlersSandboxed({
    subgraphName: "hang-probe",
    version: "1",
    handlerCode: HANG_SOURCE,
    hostCtx,
    block: { height: 1, hash: "0x1", timestamp: 0, burnBlockHeight: 0 },
    matched: matched("0xhang1"),
  });
} catch (err) {
  hangError = err.message;
}
const hangMs = Date.now() - t0;

const goodResult = await runHandlersSandboxed({
  subgraphName: "hang-probe",
  version: "1",
  handlerCode: GOOD_SOURCE,
  hostCtx,
  block: { height: 2, hash: "0x2", timestamp: 0, burnBlockHeight: 0 },
  matched: matched("0xhang2"),
});

shutdownSandboxPool();
console.log(JSON.stringify({ hangError, hangMs, goodResult }));
process.exit(0);
`;

describe("subprocess sandbox containment — proves the OS-process boundary closes the vectors that broke the Worker substrate", () => {
	test("bare process.env / globalThis.process.env / Bun.env / Bun.spawnSync are all scrubbed at the OS level; node:child_process import stays bundle-blocked; Bun.file and (Linux) /proc/<ppid>/environ remain documented-open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sg-sub-iso-"));
		const harnessFile = join(dir, "harness.ts");
		writeFileSync(harnessFile, CONTAINMENT_HARNESS);

		const proc = Bun.spawn(["bun", "run", harnessFile], {
			env: { ...process.env, SECONDLAYER_SECRETS_KEY: FAKE_SECRET },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`subprocess containment harness failed (exit ${exitCode}):\n${stderr}`,
			);
		}
		const report = JSON.parse(
			stdout.trim().split("\n").at(-1) ?? "{}",
		) as Record<string, unknown>;

		// Vectors 1-4: CLOSED — the whole point of the OS-process substrate.
		expect(report.bareEnv).toBe("<absent>"); // vector 1
		expect(report.globEnv).toBe("<absent>"); // vector 2
		expect(report.bunEnv).toBe("<absent>"); // vector 3
		// "<empty>" (not "<absent>"): Bun.spawnSync succeeds — the shell runs
		// fine, it just has nothing to echo, because the sandbox subprocess's
		// own environ (which the shell child inherits) never had the var.
		expect(report.bunSpawn).toBe("<empty>"); // vector 4 — the Worker-killer, closed here

		// Vector 5: import lockdown, unchanged from Stage 2a — still blocked.
		expect(report.fsBlocked).toBe(true);
		expect(report.cpBlocked).toBe(true);

		// Vector 6a: DOCUMENTED OPEN — same-UID filesystem read. Stage A does
		// not close this; key relocation (spike doc D3) does.
		expect(report.bunFile).toBe("readable");

		// Vector 6b: DOCUMENTED OPEN on Linux only — asserted below, not here,
		// so this test stays meaningful (not silently skipped) on any OS.
		expect(typeof report.procEnviron).toBe("string");
	}, 30_000);

	test.skipIf(process.platform !== "linux")(
		"documented-open vector 6b: /proc/<hostpid>/environ is readable from the sandbox subprocess on Linux (same-UID read — closed only by key relocation, not Stage A)",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "sg-sub-iso-proc-"));
			const harnessFile = join(dir, "harness.ts");
			writeFileSync(harnessFile, CONTAINMENT_HARNESS);
			const proc = Bun.spawn(["bun", "run", harnessFile], {
				env: { ...process.env, SECONDLAYER_SECRETS_KEY: FAKE_SECRET },
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, , exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			expect(exitCode).toBe(0);
			const report = JSON.parse(
				stdout.trim().split("\n").at(-1) ?? "{}",
			) as Record<string, unknown>;
			expect(report.platform).toBe("linux");
			// Openly documented, not silenced: the read succeeds AND returns the
			// real (fake, in this test) secret — same-UID /proc read is not a
			// boundary this substrate provides.
			expect(report.procEnviron).toBe("readable-leaked");
		},
		30_000,
	);
});

describe("subprocess sandbox crash/hang handling — a stuck or crashing handler fails the block, never skips it, and the pool recovers", () => {
	test("an infinite-loop handler is killed at the per-block deadline, surfaces as a thrown error (not a silently skipped block), and the pool respawns cleanly for the next block", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sg-sub-hang-"));
		const harnessFile = join(dir, "harness.ts");
		writeFileSync(harnessFile, CRASH_HARNESS);

		const proc = Bun.spawn(["bun", "run", harnessFile], {
			env: {
				...process.env,
				SUBGRAPH_SANDBOX_BLOCK_TIMEOUT_MS: String(SHORT_TIMEOUT_MS),
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			throw new Error(
				`hang/crash harness failed (exit ${exitCode}):\n${stderr}`,
			);
		}
		const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as {
			hangError: string | null;
			hangMs: number;
			goodResult: { processed: number; errors: number };
		};

		// The hung block must fail LOUDLY — never resolve as if it processed
		// (f040 B5: a sandbox death must never skip a block's events).
		expect(report.hangError).not.toBeNull();
		expect(report.hangError).toMatch(/exceeded \d+ms deadline/);
		// Killed at roughly the deadline, not the old 60s default and not
		// instantly (bounds are generous — this is a shared laptop, not an
		// isolated benchmark rig).
		expect(report.hangMs).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS);
		expect(report.hangMs).toBeLessThan(SHORT_TIMEOUT_MS + 15_000);

		// The pool recovers: a fresh subprocess spawns for the SAME subgraph
		// name and a normal handler runs to completion.
		expect(report.goodResult).toEqual({ processed: 1, errors: 0 });
	}, 45_000);
});
