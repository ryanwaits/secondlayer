import { describe, expect, test } from "bun:test";
import { ARCHIVE_ROOT_PUBLIC_KEY_PEM } from "@secondlayer/shared/archive/root-key";
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
	});

	test("with nothing pinned and no hosted access, the key compiled into the release resolves", async () => {
		expect(await resolveArchivePublicKey({ allowHostedApi: false })).toBe(
			ARCHIVE_ROOT_PUBLIC_KEY_PEM,
		);
		expect(ARCHIVE_ROOT_PUBLIC_KEY_PEM).toMatch(
			/^-----BEGIN PUBLIC KEY-----\n/,
		);
	});

	test("a plaintext http:// key endpoint is never consulted, even when hosted lookup is allowed", async () => {
		let hits = 0;
		const server = Bun.serve({
			port: 0,
			fetch: () => {
				hits++;
				return Response.json({ public_key_pem: "attacker" });
			},
		});
		try {
			const key = await resolveArchivePublicKey({
				allowHostedApi: true,
				hostedKeyUrl: `http://127.0.0.1:${server.port}/public/streams/signing-key`,
			});
			expect(hits).toBe(0);
			expect(key).toBe(ARCHIVE_ROOT_PUBLIC_KEY_PEM);
		} finally {
			server.stop(true);
		}
	});

	test("a pinned env key wins over whatever a key server answers", async () => {
		let hits = 0;
		const server = Bun.serve({
			port: 0,
			fetch: () => {
				hits++;
				return Response.json({ public_key_pem: "attacker" });
			},
		});
		try {
			const key = await resolveArchivePublicKey({
				envPem: "pinned",
				allowHostedApi: true,
				hostedKeyUrl: `http://127.0.0.1:${server.port}/public/streams/signing-key`,
			});
			expect(key).toBe("pinned");
			expect(hits).toBe(0);
		} finally {
			server.stop(true);
		}
	});
});
