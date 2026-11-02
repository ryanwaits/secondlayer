import { afterAll, describe, expect, test } from "bun:test";
import { type Socket, connect } from "node:net";
import { handleIgnoredObserverPost, handleNotFound } from "./observer-http.ts";

describe("draining the request body before replying", () => {
	const server = Bun.serve({
		port: 0,
		routes: {
			"/attachments/new": {
				POST: handleIgnoredObserverPost,
			},
		},
		fetch: handleNotFound,
	});
	if (server.port === undefined) throw new Error("server did not bind a port");
	const serverPort: number = server.port;

	afterAll(() => {
		server.stop(true);
	});

	type RawPostResult = {
		response: string;
		bytesWritten: number;
		errored: boolean;
	};

	/**
	 * Sends a raw HTTP POST over node:net in 8 KiB writes, waiting for
	 * `drain` on backpressure — the shape that reproduces stacks-node's
	 * observer delivery. Bun's own `fetch` client reads the response early
	 * and never observes the early-close bug.
	 */
	function sendRawPost(path: string, bodySize: number): Promise<RawPostResult> {
		const body = Buffer.alloc(bodySize, "a");
		const headers = `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${serverPort}\r\nContent-Type: application/octet-stream\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;

		return new Promise((resolve) => {
			const socket: Socket = connect(serverPort, "127.0.0.1");
			let response = "";
			let bytesWritten = 0;
			let errored = false;

			socket.on("error", () => {
				errored = true;
			});

			socket.on("data", (chunk) => {
				response += chunk.toString("utf8");
			});

			socket.on("close", () => {
				resolve({ response, bytesWritten, errored });
			});

			socket.on("connect", () => {
				void (async () => {
					socket.write(headers);
					const chunkSize = 8192;
					for (let offset = 0; offset < body.length; offset += chunkSize) {
						if (socket.destroyed) break;
						const chunk = body.subarray(
							offset,
							Math.min(offset + chunkSize, body.length),
						);
						const canContinue = socket.write(chunk);
						bytesWritten += chunk.length;
						if (!canContinue) {
							await new Promise<void>((res) => {
								const onDrain = () => {
									socket.off("close", onClose);
									res();
								};
								const onClose = () => {
									socket.off("drain", onDrain);
									res();
								};
								socket.once("drain", onDrain);
								socket.once("close", onClose);
							});
						}
					}
					if (!socket.destroyed) socket.end();
				})();
			});
		});
	}

	test("attachments POST reads a 5 MiB body before replying", async () => {
		const size = 5 * 1024 * 1024;
		const { response, bytesWritten, errored } = await sendRawPost(
			"/attachments/new",
			size,
		);
		expect(errored).toBe(false);
		expect(bytesWritten).toBe(size);
		expect(response.startsWith("HTTP/1.1 200")).toBe(true);
	});

	test("unknown path reads a 5 MiB body before replying 404", async () => {
		const size = 5 * 1024 * 1024;
		const { response, bytesWritten, errored } = await sendRawPost(
			"/unknown/path",
			size,
		);
		expect(errored).toBe(false);
		expect(bytesWritten).toBe(size);
		expect(response.startsWith("HTTP/1.1 404")).toBe(true);
	});
});
