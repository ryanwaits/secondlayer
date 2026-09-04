import type { Simnet } from "@stacks/clarinet-sdk";
import { HttpRequestError } from "../errors/http.ts";
import { getTransactionId } from "../transactions/signer.ts";
import { PayloadType } from "../transactions/types.ts";
import { deserializeTransaction } from "../transactions/wire/deserialize.ts";
import { createTransport } from "../transports/createTransport.ts";
import type {
	RequestFn,
	RequestOptions,
	TransportFactory,
} from "../transports/types.ts";
import { c32address } from "../utils/c32.ts";
import { AddressVersion } from "../utils/constants.ts";
import { hexToBytes, without0x } from "../utils/encoding.ts";
import { cvFromHex, fromChain, hexCv, stxBalance, toChain } from "./cv.ts";
import { SimnetUnsupportedError } from "./errors.ts";

type ReceiptRow = {
	tx_status: string;
	block_height: number;
	tx_result?: { hex: string };
	events: unknown[];
};

function stripQuery(path: string): string {
	const q = path.indexOf("?");
	return q === -1 ? path : path.slice(0, q);
}

function decodePath(path: string): string[] {
	return stripQuery(path)
		.split("/")
		.filter(Boolean)
		.map((s) => decodeURIComponent(s));
}

function contractId(address: string, name: string): string {
	return `${address}.${name}`;
}

function originAddress(
	signerHash160: string,
	network: "mainnet" | "testnet",
): string {
	const version =
		network === "mainnet"
			? AddressVersion.MainnetSingleSig
			: AddressVersion.TestnetSingleSig;
	return c32address(version, signerHash160);
}

function normalizeTxid(txid: string): string {
	return txid.startsWith("0x") ? txid : `0x${txid}`;
}

function notFound(path: string): never {
	throw new HttpRequestError(404, { url: path, method: "GET" });
}

function noEstimate(path: string): never {
	throw new HttpRequestError(400, {
		url: path,
		method: "POST",
		details: '{"reason":"NoEstimateAvailable"}',
	});
}

/**
 * Map Hiro/stacks-node REST paths onto an in-process Clarinet `Simnet`.
 * `getContract` / public+wallet actions then work unchanged against simnet.
 */
export function simnet(session: Simnet): TransportFactory {
	const nonces = new Map<string, number>();
	const receipts = new Map<string, ReceiptRow>();

	const request: RequestFn = async (path: string, options?: RequestOptions) => {
		const method = options?.method ?? "GET";
		const parts = decodePath(path);

		if (parts[0] === "v2" && parts[1] === "info" && method === "GET") {
			return {
				stacks_tip_height: session.stacksBlockHeight ?? session.blockHeight,
			};
		}

		if (
			parts[0] === "v2" &&
			parts[1] === "accounts" &&
			parts[2] &&
			method === "GET"
		) {
			const address = parts[2];
			return {
				nonce: nonces.get(address) ?? 0,
				balance: String(stxBalance(session, address)),
			};
		}

		if (
			parts[0] === "v2" &&
			parts[1] === "contracts" &&
			parts[2] === "call-read" &&
			parts[3] &&
			parts[4] &&
			parts[5] &&
			method === "POST"
		) {
			const body = options?.body as
				| { sender?: string; arguments?: string[] }
				| undefined;
			const id = contractId(parts[3], parts[4]);
			const fn = parts[5];
			const sender = body?.sender ?? parts[3];
			const args = (body?.arguments ?? []).map((hex) =>
				toChain(cvFromHex(hex)),
			);
			try {
				const { result } = session.callReadOnlyFn(id, fn, args, sender);
				return { okay: true, result: hexCv(fromChain(result)) };
			} catch (error) {
				const cause = error instanceof Error ? error.message : String(error);
				return { okay: false, cause };
			}
		}

		if (
			parts[0] === "v2" &&
			parts[1] === "map_entry" &&
			parts[2] &&
			parts[3] &&
			parts[4] &&
			method === "POST"
		) {
			const keyHex =
				typeof options?.body === "string"
					? options.body
					: String(options?.body ?? "");
			const value = session.getMapEntry(
				contractId(parts[2], parts[3]),
				parts[4],
				toChain(cvFromHex(keyHex)),
			);
			return { data: hexCv(fromChain(value)) };
		}

		if (
			parts[0] === "v2" &&
			parts[1] === "data_var" &&
			parts[2] &&
			parts[3] &&
			parts[4] &&
			method === "GET"
		) {
			const value = session.getDataVar(
				contractId(parts[2], parts[3]),
				parts[4],
			);
			return { data: hexCv(fromChain(value)) };
		}

		if (parts[0] === "v2" && parts[1] === "fees" && method === "POST") {
			noEstimate(path);
		}

		if (parts[0] === "v2" && parts[1] === "transactions" && method === "POST") {
			return handleBroadcast(session, options?.body, nonces, receipts);
		}

		if (
			parts[0] === "extended" &&
			parts[1] === "v1" &&
			parts[2] === "tx" &&
			parts[3] &&
			method === "GET"
		) {
			const row = receipts.get(normalizeTxid(parts[3]));
			if (!row) notFound(path);
			return row;
		}

		throw new SimnetUnsupportedError(stripQuery(path));
	};

	return () => createTransport("simnet", { request });
}

function handleBroadcast(
	session: Simnet,
	body: unknown,
	nonces: Map<string, number>,
	receipts: Map<string, ReceiptRow>,
): { txid: string } {
	const txHex =
		typeof body === "object" && body !== null && "tx" in body
			? String((body as { tx: string }).tx)
			: "";
	const tx = deserializeTransaction(hexToBytes(without0x(txHex)));
	const txid = normalizeTxid(getTransactionId(tx));
	const network = tx.chainId === 0x00000001 ? "mainnet" : "testnet";
	const sender = originAddress(tx.auth.spendingCondition.signer, network);

	let resultHex: string | undefined;
	let events: unknown[] = [];
	let aborted = false;

	if (tx.payload.payloadType === PayloadType.ContractCall) {
		const p = tx.payload;
		const id = contractId(p.contractAddress, p.contractName);
		const parsed = session.callPublicFn(
			id,
			p.functionName,
			p.functionArgs.map(toChain),
			sender,
		);
		const ours = fromChain(parsed.result);
		resultHex = hexCv(ours);
		events = parsed.events;
		aborted = ours.type === "err";
	} else if (tx.payload.payloadType === PayloadType.TokenTransfer) {
		const recipient = tx.payload.recipient;
		const to =
			recipient.type === "address" || recipient.type === "contract"
				? recipient.value
				: sender;
		const parsed = session.transferSTX(tx.payload.amount, to, sender);
		resultHex = hexCv(fromChain(parsed.result));
		events = parsed.events;
	} else {
		throw new SimnetUnsupportedError(
			`POST /v2/transactions payload ${tx.payload.payloadType}`,
		);
	}

	nonces.set(sender, Number(tx.auth.spendingCondition.nonce) + 1);
	receipts.set(txid, {
		tx_status: aborted ? "abort_by_response" : "success",
		block_height: session.stacksBlockHeight ?? session.blockHeight,
		tx_result: resultHex ? { hex: resultHex } : undefined,
		events,
	});
	return { txid };
}
