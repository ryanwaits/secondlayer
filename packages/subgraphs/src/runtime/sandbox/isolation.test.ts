import { describe, expect, test } from "bun:test";
// f071 Stage 2a — the isolation regression LOCK (STOPPED state).
//
// This test does NOT assert that the sandbox isolates untrusted code — it
// asserts the OPPOSITE, on purpose, because Step 7 of the plan discovered
// (and the spike doc §10 documents) that a Bun `Worker` with `env: {}` + the
// esbuild resolver lockdown does NOT contain untrusted handler code. It is a
// green, CI-enforced record of exactly which access forms leak, so nobody
// re-adopts the Bun `Worker` substrate believing it's a trust boundary.
//
// Run through a REAL subprocess with a REAL OS env var (never a JS
// `process.env` mutation — the f060 spike proved that does not reach a Bun
// Worker's inherited env). The subprocess carries a KNOWN FAKE
// SECONDLAYER_SECRETS_KEY so the assertions never touch the repo's real key.
//
// What it locks in:
//   - `globalThis.process.env.X`  → SCRUBBED (env:{} works for this form)   ✓
//   - `Bun.env.X`                 → SCRUBBED                                 ✓
//   - `import("node:fs")` etc.    → BLOCKED (bundle-time resolver lockdown)  ✓
//   - bare `process.env.X`        → *** LEAKS *** (getenv-backed binding)    ✗
//   - `globalThis.Bun.spawnSync`  → *** LEAKS the host environ ***           ✗
//   - `Bun.file(path)`            → *** arbitrary filesystem read ***        ✗
// The last three are why the sandbox is STOPPED. If a future Bun release
// closes them, these expectations flip and this test is the signal to
// re-evaluate the substrate.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_SECRET = "f071fakesecret_deadbeef_never_the_real_key";

const HARNESS = `
import { bundleHandlerCode } from ${JSON.stringify(join(HERE, "bundle.ts"))};
import { spawnSandboxWorker } from ${JSON.stringify(join(HERE, "host.ts"))};

// A handler that probes every ambient-authority vector and ships the results
// home via ctx.insert (buffered ops are what blockDone returns).
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
  } } },
  handlers: {
    tick: (event, ctx) => {
      const row = {};
      try { row.bareEnv = process.env.SECONDLAYER_SECRETS_KEY ?? "<absent>"; } catch (e) { row.bareEnv = "throw"; }
      try { row.globEnv = (globalThis.process && globalThis.process.env && globalThis.process.env.SECONDLAYER_SECRETS_KEY) || "<absent>"; } catch (e) { row.globEnv = "throw"; }
      try { row.bunEnv = (globalThis.Bun && globalThis.Bun.env && globalThis.Bun.env.SECONDLAYER_SECRETS_KEY) || "<absent>"; } catch (e) { row.bunEnv = "throw"; }
      try {
        const r = globalThis.Bun.spawnSync({ cmd: ["/bin/sh", "-c", "echo $SECONDLAYER_SECRETS_KEY"] });
        row.bunSpawn = new TextDecoder().decode(r.stdout).trim() || "<empty>";
      } catch (e) { row.bunSpawn = "BLOCKED"; }
      try {
        const canary = "/tmp/f071-fs-canary-" + Math.random().toString(36).slice(2);
        globalThis.Bun.write(canary, "CANARY");
        row.bunFile = globalThis.Bun.file(canary).size >= 0 ? "readable" : "no";
      } catch (e) { row.bunFile = "BLOCKED"; }
      ctx.insert("probe", row);
    },
  },
});
\`;

const MATCHED = [{
  sourceName: "tick", events: [],
  tx: { tx_id: "0xiso", type: "contract_call", sender: "SP0", status: "success", tx_index: 0, contract_id: null, function_name: null },
}];
const BLOCK = { height: 1, hash: "0x0", timestamp: 0, burnBlockHeight: 0 };

function runProbe() {
  return new Promise(async (resolve, reject) => {
    const bundled = await bundleHandlerCode(PROBE_SOURCE);
    const worker = spawnSandboxWorker(); // production posture: env: {}
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "ready") { worker.postMessage({ type: "runBlock", block: BLOCK, matched: MATCHED }); return; }
      if (msg.type === "blockDone") { worker.terminate(); resolve(msg.ops[0] ? msg.ops[0].args[0] : {}); return; }
      if (msg.type === "error") { worker.terminate(); reject(new Error(msg.message)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(String(e.message))); };
    worker.postMessage({ type: "init", bundledCode: bundled, version: "1" });
  });
}

async function bundleBlocks(source) {
  const bundled = await bundleHandlerCode(source);
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const dir = mkdtempSync(join(tmpdir(), "iso-b-"));
  const file = join(dir, "h.mjs");
  writeFileSync(file, bundled);
  try { await import(pathToFileURL(file).href); return false; } catch { return true; }
}

const probe = await runProbe();
const fsBlocked = await bundleBlocks('import { readFileSync } from "node:fs"; export default { r: readFileSync };');
const cpBlocked = await bundleBlocks('import { execSync } from "node:child_process"; export default { e: execSync };');

const redact = (v) => v === "<absent>" ? "<absent>" : (v === ${JSON.stringify(FAKE_SECRET)} ? "<leaked-fake>" : (v === "readable" ? "readable" : "<other>"));
console.log(JSON.stringify({
  bareEnv: redact(probe.bareEnv),
  globEnv: redact(probe.globEnv),
  bunEnv: redact(probe.bunEnv),
  bunSpawn: redact(probe.bunSpawn),
  bunFile: probe.bunFile,
  fsBlocked, cpBlocked,
}));
process.exit(0);
`;

describe("sandbox isolation regression — documents that the Bun Worker substrate does NOT isolate", () => {
	test("env:{} + resolver lockdown block only globalThis.process.env / Bun.env / node imports; bare process.env and globalThis.Bun leak", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sg-iso-"));
		const harnessFile = join(dir, "harness.ts");
		writeFileSync(harnessFile, HARNESS);

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
				`isolation harness failed (exit ${exitCode}):\n${stderr}`,
			);
		}
		const report = JSON.parse(
			stdout.trim().split("\n").at(-1) ?? "{}",
		) as Record<string, unknown>;

		// The parts that DO hold (kept as positive locks):
		expect(report.globEnv).toBe("<absent>"); // globalThis.process.env scrubbed
		expect(report.bunEnv).toBe("<absent>"); // Bun.env scrubbed
		expect(report.fsBlocked).toBe(true); // node:fs bundle-locked
		expect(report.cpBlocked).toBe(true); // node:child_process bundle-locked

		// The BREAK this test exists to lock in (STOPPED state — see spike §10).
		// If any of these ever flips to a blocked/absent value, the Bun Worker
		// substrate may have become viable — re-evaluate before trusting it.
		expect(report.bareEnv).toBe("<leaked-fake>"); // bare process.env leaks
		expect(report.bunSpawn).toBe("<leaked-fake>"); // Bun.spawnSync reaches host environ
		expect(report.bunFile).toBe("readable"); // Bun.file = arbitrary FS read
	}, 30_000);
});
