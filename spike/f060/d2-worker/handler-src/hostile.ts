// f060 SPIKE — the isolation-demo fixture (D2's answer to open question
// "Is a Bun Worker env-scrub + resolver lockdown a real boundary, or can a
// handler still reach ambient authority?").
//
// Mirrors spike/malicious-subgraph.ts's shape from the f049 spike: a
// syntactically ordinary handler that tries, at call time, to reach three
// forms of ambient authority a real attacker would want:
//   1. the master secrets key via process.env
//   2. the filesystem via node:fs (to write an exfil payload / read other
//      tenants' handler_path files)
//   3. process spawning via node:child_process (to shell out)
//
// Each attempt is wrapped so one failure doesn't hide the others; the report
// is handed back to the handler's return value (not postMessage directly —
// keeps this file DB/ctx-shaped like a real handler, worker-entry.ts is what
// decides how to relay it to the host).
interface HostileReport {
	envSecret: string;
	fsBlocked: boolean;
	fsError: string;
	childProcessBlocked: boolean;
	childProcessError: string;
}

export default async function handler(): Promise<HostileReport> {
	const report: HostileReport = {
		envSecret: "<not attempted>",
		fsBlocked: false,
		fsError: "",
		childProcessBlocked: false,
		childProcessError: "",
	};

	// 1. Ambient env — the master AES key that decrypts every tenant's BYO
	// connection string (packages/shared/src/crypto/secrets.ts).
	try {
		// biome-ignore lint/suspicious/noExplicitAny: reading ambient global, not a typed API
		const p = (globalThis as any).process;
		report.envSecret = p?.env?.SECONDLAYER_SECRETS_KEY ?? "<absent>";
	} catch (err) {
		report.envSecret = `<threw: ${(err as Error).message}>`;
	}

	// 2. Filesystem — stands in for exfiltrating the key to disk, or reading
	// another tenant's handler_path off DATA_DIR.
	try {
		const fs = await import("node:fs");
		fs.appendFileSync("/tmp/f060-exfil-canary.log", "EXFIL\n");
		report.fsBlocked = false;
		report.fsError = "<no error — import + write both succeeded>";
	} catch (err) {
		report.fsBlocked = true;
		report.fsError = (err as Error).message;
	}

	// 3. Process spawning — stands in for shelling out / reverse shell.
	try {
		const cp = await import("node:child_process");
		cp.execSync("echo pwned");
		report.childProcessBlocked = false;
		report.childProcessError = "<no error — import + exec both succeeded>";
	} catch (err) {
		report.childProcessBlocked = true;
		report.childProcessError = (err as Error).message;
	}

	return report;
}
