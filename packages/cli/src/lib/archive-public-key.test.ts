import { describe, expect, test } from "bun:test";
import { resolveArchivePublicKey } from "./archive-reference.ts";

describe("archive public key", () => {
	test("prefers an explicit pin, then env, and never hits hosted in OSS", async () => {
		expect(
			await resolveArchivePublicKey({
				explicitPem: "explicit",
				envPem: "env",
				allowHostedApi: false,
			}),
		).toBe("explicit");
		expect(
			await resolveArchivePublicKey({
				envPem: "env",
				allowHostedApi: false,
			}),
		).toBe("env");
		expect(
			await resolveArchivePublicKey({
				allowHostedApi: false,
			}),
		).toBeUndefined();
	});
});
