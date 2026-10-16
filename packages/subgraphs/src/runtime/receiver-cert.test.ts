import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type tls from "node:tls";
import { getDb } from "@secondlayer/shared/db";
import { createWebhook } from "@secondlayer/shared/db/queries/webhooks";
import { __setDnsLookupForTest } from "./emitter.ts";
import { probeCertExpiry, refreshReceiverCerts } from "./receiver-cert.ts";

type FakeSocket = EventEmitter & {
	getPeerCertificate: () => { valid_to: string };
	destroy: () => void;
	destroyed: boolean;
};

/** A `tls.connect` stand-in: records calls, then runs `onConnect` on the socket. */
function fakeConnect(onConnect: (socket: FakeSocket) => void) {
	const calls: unknown[] = [];
	const connect = ((options: unknown) => {
		calls.push(options);
		const socket = new EventEmitter() as FakeSocket;
		socket.destroyed = false;
		socket.destroy = () => {
			socket.destroyed = true;
		};
		socket.getPeerCertificate = () => ({
			valid_to: "Dec 25 22:56:35 2026 GMT",
		});
		queueMicrotask(() => onConnect(socket));
		return socket;
	}) as unknown as typeof tls.connect;
	return { connect, calls };
}

describe("probeCertExpiry", () => {
	let priorAllow: string | undefined;

	beforeEach(() => {
		priorAllow = process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS;
		Reflect.deleteProperty(process.env, "SECONDLAYER_ALLOW_PRIVATE_EGRESS");
		__setDnsLookupForTest(async () => [
			{ address: "93.184.216.34", family: 4 },
		]);
	});

	afterEach(() => {
		__setDnsLookupForTest(null);
		if (priorAllow === undefined) {
			Reflect.deleteProperty(process.env, "SECONDLAYER_ALLOW_PRIVATE_EGRESS");
		} else {
			process.env.SECONDLAYER_ALLOW_PRIVATE_EGRESS = priorAllow;
		}
	});

	it("returns the leaf certificate's expiry once the handshake completes", async () => {
		const { connect, calls } = fakeConnect((socket) =>
			socket.emit("secureConnect"),
		);
		const expires = await probeCertExpiry("https://receiver.example/hook", {
			connect,
		});
		expect(expires?.toISOString()).toBe("2026-12-25T22:56:35.000Z");
		expect(calls[0]).toMatchObject({
			host: "receiver.example",
			port: 443,
			servername: "receiver.example",
			rejectUnauthorized: false,
		});
	});

	it("returns null for an http URL without connecting", async () => {
		const { connect, calls } = fakeConnect((socket) =>
			socket.emit("secureConnect"),
		);
		expect(
			await probeCertExpiry("http://receiver.example/hook", { connect }),
		).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("returns null without connecting when egress is refused", async () => {
		const { connect, calls } = fakeConnect((socket) =>
			socket.emit("secureConnect"),
		);
		expect(
			await probeCertExpiry("https://127.0.0.1/hook", { connect }),
		).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it("returns null when the handshake never completes before the timeout", async () => {
		const { connect } = fakeConnect(() => {});
		expect(
			await probeCertExpiry("https://receiver.example/hook", {
				connect,
				timeoutMs: 20,
			}),
		).toBeNull();
	});

	it("returns null when the connection errors", async () => {
		const { connect } = fakeConnect((socket) =>
			socket.emit("error", new Error("ECONNREFUSED")),
		);
		expect(
			await probeCertExpiry("https://receiver.example/hook", { connect }),
		).toBeNull();
	});
});

describe.skipIf(!process.env.DATABASE_URL)("refreshReceiverCerts", () => {
	it("stores the probed expiry and check time on its own due webhook, never touching the network", async () => {
		process.env.SECONDLAYER_SECRETS_KEY =
			process.env.SECONDLAYER_SECRETS_KEY ?? "0".repeat(64);
		const db = getDb();
		const host = `cert-refresh-${crypto.randomUUID()}.receiver.example`;
		const { webhook } = await createWebhook(db, {
			accountId: "",
			name: `cert-refresh-${crypto.randomUUID()}`,
			triggers: [{ type: "stx_transfer" }],
			url: `https://${host}/hook`,
		});
		const expires = new Date("2027-03-04T05:06:07.000Z");
		try {
			// Other rows on a shared database may be due too; the fake probe
			// answers only for this test's host.
			await refreshReceiverCerts(db, {
				probe: async (url) => (new URL(url).host === host ? expires : null),
			});
			const row = await db
				.selectFrom("webhooks")
				.select(["receiver_cert_expires_at", "receiver_cert_checked_at"])
				.where("id", "=", webhook.id)
				.executeTakeFirstOrThrow();
			expect(row.receiver_cert_expires_at?.toISOString()).toBe(
				expires.toISOString(),
			);
			expect(row.receiver_cert_checked_at).toBeInstanceOf(Date);
		} finally {
			await db.deleteFrom("webhooks").where("id", "=", webhook.id).execute();
		}
	});
});
