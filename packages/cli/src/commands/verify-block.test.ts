import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { hex, parseNakamotoHeader, verifyBlock } from "@secondlayer/verify";
import { FakeSource, signerChain } from "../../../verify/test/fake-source.ts";
import { headerFile } from "../../../verify/test/fixtures.ts";
import { runVerifyBlock, verificationJson } from "./verify-block.ts";

// Mainnet fixtures from @secondlayer/verify: checkpoint block 8,956,304 (set
// 143), anchor A proving set 144, and target H = 9,137,005 with its witness.
const { checkpoint: B, a: A, h: H } = signerChain;
const source = () => new FakeSource({ heights: [B, A, H] });
const parentOf = (id: string) =>
	hex(parseNakamotoHeader(headerFile(id)).parentBlockId);

/** Run with stdout and stderr captured. */
async function run(
	ref: string,
	opts: Parameters<typeof runVerifyBlock>[1],
	src: FakeSource,
) {
	let stdout = "";
	let stderr = "";
	const write = process.stdout.write;
	const error = console.error;
	process.stdout.write = ((chunk: string) => {
		stdout += chunk;
		return true;
	}) as typeof process.stdout.write;
	console.error = (...args: unknown[]) => {
		stderr += `${args.join(" ")}\n`;
	};
	try {
		const code = await runVerifyBlock(ref, opts, { source: src });
		return { code, stdout, stderr };
	} finally {
		process.stdout.write = write;
		console.error = error;
	}
}

describe("verify block", () => {
	test("proves 9,137,005 from the baked checkpoint, one line per link, and exits 0", async () => {
		const r = await run("9137005", {}, source());
		expect(r.code).toBe(0);
		const lines = r.stdout.trim().split("\n");
		expect(lines).toEqual([
			`✓ block       9,137,005  ${H}`,
			"✓ bitcoin     headers 967,680..970,269, proof-of-work and retargets checked",
			"✓ burn        height 970,269  00000000000000000001abf5e92c4e771c041ff3a9fde450c2291775641a801c",
			"✓ cycle       144, signer set proven forward from checkpoint cycle 143",
			"✓ signatures  2,866 / 4,000 weight signed, threshold 2,800",
			expect.stringMatching(
				/^✓ state root {2}[0-9a-f]{64} matches the witness$/,
			),
			"✓ diff        18 written (unnamed; --rows names them), 1 carried, 5 internal",
			"· rows        not checked (pass --rows)",
			"✓ Block 9,137,005 is proven. Trusted: only the checkpoint (Stacks 8,956,304, Bitcoin 967,680).",
		]);
		// Progress is chrome: stderr only.
		expect(r.stderr).toContain("syncing Bitcoin headers 967,681..969,696");
	});

	test("an index block hash names the same block", async () => {
		const r = await run(`0x${H}`, {}, source());
		expect(r.code).toBe(0);
		expect(r.stdout).toContain(`✓ block       9,137,005  ${H}`);
	});

	test("a witness that does not hash to the signed state root breaks the state-root link and exits 1", async () => {
		const src = source();
		src.witnesses.set(H, src.witnesses.get(parentOf(H)) as Uint8Array);
		const r = await run("9137005", {}, src);
		expect(r.code).toBe(1);
		const lines = r.stdout.trim().split("\n");
		expect(lines[4]).toStartWith("✓ signatures");
		expect(lines[5]).toStartWith("✗ state root");
		expect(lines[6]).toBe(
			"· diff        not checked: an earlier link is broken",
		);
		expect(lines.at(-1)).toBe("✗ Not proven: the state root link is broken.");
	});

	test("a source that cannot serve a link exits 2: unchecked is never clean", async () => {
		const src = source();
		src.getBitcoinHeaders = async () => {
			throw new Error("connection refused");
		};
		const r = await run("9137005", {}, src);
		expect(r.code).toBe(2);
		expect(r.stdout).toContain("✗ bitcoin");
		expect(r.stdout.trim().split("\n").at(-1)).toBe(
			"✗ Could not check the bitcoin link: the source could not serve it.",
		);
	});

	test("--json prints verifyBlock's result with weights as decimal strings, and nothing else on stdout", async () => {
		const r = await run("9137005", { json: true }, source());
		expect(r.code).toBe(0);
		const direct = await verifyBlock(9137005, { source: source() });
		expect(JSON.parse(r.stdout)).toEqual(JSON.parse(verificationJson(direct)));
		expect(JSON.parse(r.stdout)).toMatchObject({
			ok: true,
			signerWeight: "2866",
		});
	});

	test("--json on a broken block still exits 1", async () => {
		const src = source();
		src.witnesses.set(H, src.witnesses.get(parentOf(H)) as Uint8Array);
		const r = await run("9137005", { json: true }, src);
		expect(r.code).toBe(1);
		expect(JSON.parse(r.stdout).failures[0]).toMatchObject({
			step: "witness",
			code: "root-mismatch",
		});
	});

	test("without --rows the Index API is never read; with it, both reads are made", async () => {
		const reads: string[] = [];
		const src = Object.assign(source(), {
			getStateWrites: async (h: number) => {
				reads.push(`state_writes ${h}`);
				return null;
			},
			getVmEvents: async (h: number) => {
				reads.push(`vm_events ${h}`);
				return [];
			},
		});
		await run("9137005", {}, src);
		expect(reads).toEqual([]);
		await run("9137005", { rows: true }, src);
		expect(reads).toEqual(["state_writes 9137005", "vm_events 9137005"]);
	});

	test("bad input exits 2 before any fetch", async () => {
		const src = source();
		expect((await run("tip", {}, src)).code).toBe(2);
		expect(
			(await run("9137005", { checkpoint: "/nonexistent.json" }, src)).code,
		).toBe(2);
		expect(src.log).toEqual([]);
	});
});

describe("verify block on the command line", () => {
	const cli = join(import.meta.dir, "../cli.ts");
	const spawn = async (...args: string[]) => {
		const proc = Bun.spawn([process.execPath, "run", cli, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, NO_COLOR: "1" },
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, code };
	};

	test("runs without the parent's --against", async () => {
		const r = await spawn("verify", "block", "not-a-block", "--json");
		expect(r.code).toBe(2);
		expect(r.stderr).toContain("expected a block height");
		expect(r.stderr).not.toContain("--against");
	});

	test("plain verify still requires --against", async () => {
		const r = await spawn("verify", "raw");
		expect(r.code).toBe(1);
		expect(r.stderr).toContain(
			"required option '--against <manifest>' not specified",
		);
	});

	test("help says what is proven and that only the checkpoint is trusted", async () => {
		const r = await spawn("verify", "block", "--help");
		expect(r.code).toBe(0);
		expect(r.stdout).toContain("Nothing is trusted except the checkpoint");
		expect(r.stdout).toContain("--rows");
	});
});
