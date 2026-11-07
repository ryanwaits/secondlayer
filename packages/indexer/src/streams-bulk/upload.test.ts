import { describe, expect, test } from "bun:test";
import type { S3Client } from "@aws-sdk/client-s3";
import { PreconditionFailedError, putJsonObject } from "./upload.ts";

type SentInput = Record<string, unknown>;

function fakeClient(respond: (input: SentInput) => void = () => {}) {
	const sent: SentInput[] = [];
	const client = {
		send: async (command: { input: SentInput }) => {
			sent.push(command.input);
			respond(command.input);
			return {};
		},
	} as unknown as S3Client;
	return { client, sent };
}

describe("putJsonObject conditions", () => {
	const base = { bucket: "b", key: "latest.json", value: { a: 1 } };

	test("an ETag writes only if the object is unchanged", async () => {
		const { client, sent } = fakeClient();
		await putJsonObject({ ...base, client, ifMatch: '"abc"' });
		expect(sent[0]?.IfMatch).toBe('"abc"');
		expect(sent[0]?.IfNoneMatch).toBeUndefined();
	});

	test("null writes only if the object does not exist", async () => {
		const { client, sent } = fakeClient();
		await putJsonObject({ ...base, client, ifMatch: null });
		expect(sent[0]?.IfNoneMatch).toBe("*");
		expect(sent[0]?.IfMatch).toBeUndefined();
	});

	test("without a condition the write is unconditional", async () => {
		const { client, sent } = fakeClient();
		await putJsonObject({ ...base, client });
		expect(sent[0]?.IfMatch).toBeUndefined();
		expect(sent[0]?.IfNoneMatch).toBeUndefined();
	});

	test("a 412 from the bucket surfaces as a lost race", async () => {
		const { client } = fakeClient(() => {
			throw Object.assign(new Error("precondition"), {
				$metadata: { httpStatusCode: 412 },
			});
		});
		await expect(
			putJsonObject({ ...base, client, ifMatch: '"old"' }),
		).rejects.toBeInstanceOf(PreconditionFailedError);
	});

	test("a 412 on an unconditional write is not rewrapped", async () => {
		const { client } = fakeClient(() => {
			throw Object.assign(new Error("odd"), {
				$metadata: { httpStatusCode: 412 },
			});
		});
		await expect(putJsonObject({ ...base, client })).rejects.not.toBeInstanceOf(
			PreconditionFailedError,
		);
	});
});
