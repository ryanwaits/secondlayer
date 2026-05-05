import { readFile, stat } from "node:fs/promises";
import {
	GetObjectCommand,
	HeadObjectCommand,
	NotFound,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export type StreamsBulkR2Config = {
	endpoint: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
};

export function getStreamsBulkR2ConfigFromEnv(): StreamsBulkR2Config {
	const endpoint = process.env.STREAMS_BULK_R2_ENDPOINT;
	const accessKeyId = process.env.STREAMS_BULK_R2_ACCESS_KEY_ID;
	const secretAccessKey = process.env.STREAMS_BULK_R2_SECRET_ACCESS_KEY;
	const bucket = process.env.STREAMS_BULK_R2_BUCKET;

	const missing = [
		["STREAMS_BULK_R2_ENDPOINT", endpoint],
		["STREAMS_BULK_R2_ACCESS_KEY_ID", accessKeyId],
		["STREAMS_BULK_R2_SECRET_ACCESS_KEY", secretAccessKey],
		["STREAMS_BULK_R2_BUCKET", bucket],
	]
		.filter(([, value]) => !value)
		.map(([key]) => key);

	if (missing.length > 0) {
		throw new Error(`missing R2 config: ${missing.join(", ")}`);
	}

	return {
		endpoint: required(endpoint, "STREAMS_BULK_R2_ENDPOINT"),
		accessKeyId: required(
			accessKeyId,
			"STREAMS_BULK_R2_ACCESS_KEY_ID",
		),
		secretAccessKey: required(
			secretAccessKey,
			"STREAMS_BULK_R2_SECRET_ACCESS_KEY",
		),
		bucket: required(bucket, "STREAMS_BULK_R2_BUCKET"),
	};
}

export function createStreamsBulkS3Client(config: StreamsBulkR2Config): S3Client {
	return new S3Client({
		region: "auto",
		endpoint: config.endpoint,
		forcePathStyle: true,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
}

export async function objectExists(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<boolean> {
	try {
		await params.client.send(
			new HeadObjectCommand({ Bucket: params.bucket, Key: params.key }),
		);
		return true;
	} catch (error) {
		if (error instanceof NotFound || hasHttpStatus(error, 404)) return false;
		throw error;
	}
}

export async function putJsonObject(params: {
	client: S3Client;
	bucket: string;
	key: string;
	value: unknown;
}): Promise<void> {
	await params.client.send(
		new PutObjectCommand({
			Bucket: params.bucket,
			Key: params.key,
			Body: `${JSON.stringify(params.value, null, 2)}\n`,
			ContentType: "application/json; charset=utf-8",
		}),
	);
}

export async function putFileObject(params: {
	client: S3Client;
	bucket: string;
	key: string;
	path: string;
	contentType: string;
}): Promise<void> {
	const [body, fileStat] = await Promise.all([
		readFile(params.path),
		stat(params.path),
	]);
	await params.client.send(
		new PutObjectCommand({
			Bucket: params.bucket,
			Key: params.key,
			Body: body,
			ContentType: params.contentType,
			ContentLength: fileStat.size,
		}),
	);
}

export async function getObjectBuffer(params: {
	client: S3Client;
	bucket: string;
	key: string;
}): Promise<Buffer> {
	const response = await params.client.send(
		new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
	);
	if (!response.Body) throw new Error(`empty object body: ${params.key}`);
	return streamBodyToBuffer(response.Body);
}

async function streamBodyToBuffer(body: unknown): Promise<Buffer> {
	if (body instanceof Uint8Array) return Buffer.from(body);
	if (
		body &&
		typeof body === "object" &&
		Symbol.asyncIterator in body
	) {
		const chunks: Uint8Array[] = [];
		for await (const chunk of body as AsyncIterable<Uint8Array>) {
			chunks.push(chunk);
		}
		return Buffer.concat(chunks);
	}
	if (
		body &&
		typeof body === "object" &&
		"transformToByteArray" in body &&
		typeof body.transformToByteArray === "function"
	) {
		return Buffer.from(await body.transformToByteArray());
	}
	throw new Error("unsupported S3 object body");
}

function hasHttpStatus(error: unknown, statusCode: number): boolean {
	if (!error || typeof error !== "object") return false;
	const metadata = (error as { $metadata?: { httpStatusCode?: number } })
		.$metadata;
	return metadata?.httpStatusCode === statusCode;
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new Error(`missing R2 config: ${name}`);
	return value;
}
