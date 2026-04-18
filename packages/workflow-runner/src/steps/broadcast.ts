import type { Database } from "@secondlayer/shared/db";
import { logger } from "@secondlayer/shared/logger";
import {
	http,
	type BroadcastOptions,
	type BroadcastResult,
	type BroadcastRuntime,
	type TxIntent,
	TxRejectedError,
	createPublicClient,
	mainnet,
	testnet,
} from "@secondlayer/stacks";
import type { PublicClient } from "@secondlayer/stacks";
import { getNonce } from "@secondlayer/stacks/actions";
import {
	buildContractCall,
	buildTokenTransfer,
} from "@secondlayer/stacks/transactions";
import type { RemoteSignerConfig } from "@secondlayer/workflows";
import {
	type StacksTransactionWire,
	getAddressFromPublicKey,
	serializeTransaction,
} from "@stacks/transactions";
import type { Kysely } from "kysely";
import type { SignerSecretStore } from "../secrets/store.ts";
import { type TxBreakdown, requestSignature } from "../signers/remote.ts";

interface RuntimeContext {
	db: Kysely<Database>;
	runId: string;
	workflow: string;
	workflowSigners: Record<string, RemoteSignerConfig>;
	accountId: string;
	secrets: SignerSecretStore;
}

/**
 * Default fee (micro-STX) used when the workflow author didn't provide
 * `maxFee`. 10k µSTX (0.01 STX) covers typical transfers; contract calls
 * may need more via `maxFee`.
 */
const DEFAULT_FEE_MICROSTX = 10_000n;

/**
 * Construct a `BroadcastRuntime` that the stacks SDK's `broadcast()` call
 * delegates to. The runtime resolves the named signer against the
 * workflow's declared config, fetches the HMAC secret on demand, builds
 * the unsigned tx, posts to the remote signer, and submits the signed tx
 * via the public client.
 *
 * Sprint 4 scope: `TransferIntent` + `ContractCallIntent`. Deploy and
 * multisend intents throw — broaden in a future sprint when we see
 * customer demand.
 */
export function createBroadcastRuntime(ctx: RuntimeContext): BroadcastRuntime {
	return {
		async broadcast(intent, opts) {
			return broadcastIntent(ctx, intent, opts);
		},
	};
}

async function broadcastIntent(
	ctx: RuntimeContext,
	intent: TxIntent,
	opts: BroadcastOptions,
): Promise<BroadcastResult> {
	const signerConfig = ctx.workflowSigners[opts.signer];
	if (!signerConfig) {
		throw new Error(
			`Workflow "${ctx.workflow}" does not declare a signer named "${opts.signer}". ` +
				`Add it under \`signers: { ${opts.signer}: signer.remote({...}) }\`.`,
		);
	}
	if (signerConfig.kind !== "remote") {
		throw new Error(
			`Unsupported signer kind "${signerConfig.kind}". v2 ships remote signers only.`,
		);
	}

	const hmacSecret = await ctx.secrets.get(ctx.accountId, signerConfig.hmacRef);

	const chain = process.env.STACKS_CHAIN === "testnet" ? testnet : mainnet;
	const publicClient = createPublicClient({
		chain,
		transport: http(process.env.STACKS_RPC_URL),
	});

	const senderAddress = getAddressFromPublicKey(
		signerConfig.publicKey,
		chain.network === "mainnet" ? "mainnet" : "testnet",
	);

	const nonce = await getNonce(publicClient, { address: senderAddress });
	const fee = opts.maxFee ?? DEFAULT_FEE_MICROSTX;

	const { unsignedTx, breakdown } = buildIntent(intent, {
		fee,
		nonce: BigInt(nonce),
		publicKey: signerConfig.publicKey,
		chain,
	});

	const unsignedTxHex = Buffer.from(
		serializeTransaction(unsignedTx as StacksTransactionWire),
	).toString("hex");

	logger.info("broadcast: signing", {
		signer: opts.signer,
		workflow: ctx.workflow,
		intentKind: intent.kind,
	});

	const { signedTxHex } = await requestSignature({
		signer: signerConfig,
		signerName: opts.signer,
		hmacSecret,
		tx: {
			...breakdown,
			unsignedTxHex,
			fee: fee.toString(),
			nonce: nonce.toString(),
		},
		runId: ctx.runId,
		workflow: ctx.workflow,
		stepId: "broadcast",
		caps: {
			maxMicroStx: opts.maxMicroStx,
			maxFee: opts.maxFee,
		},
	});

	// Submit the signed tx via Stacks node.
	const txId = await submitSignedTx(publicClient, signedTxHex);

	logger.info("broadcast: submitted", {
		signer: opts.signer,
		workflow: ctx.workflow,
		txId,
	});

	return {
		txId,
		confirmed: false,
	};
}

interface BuildOptions {
	fee: bigint;
	nonce: bigint;
	publicKey: string;
	chain: typeof mainnet | typeof testnet;
}

function buildIntent(
	intent: TxIntent,
	opts: BuildOptions,
): {
	unsignedTx: unknown;
	breakdown: Omit<TxBreakdown, "unsignedTxHex" | "fee" | "nonce">;
} {
	if (intent.kind === "transfer") {
		const tx = buildTokenTransfer({
			recipient: intent.recipient,
			amount: intent.amount,
			memo: intent.memo,
			fee: opts.fee,
			nonce: opts.nonce,
			publicKey: opts.publicKey,
			chain: opts.chain,
			postConditions: intent.postConditions as never,
		});
		return {
			unsignedTx: tx,
			breakdown: {
				kind: "transfer",
				recipient: intent.recipient,
				amount: intent.amount.toString(),
				memo: intent.memo,
			},
		};
	}
	if (intent.kind === "contract-call") {
		const [contractAddress, contractName] = intent.contract.split(".", 2);
		if (!contractAddress || !contractName) {
			throw new Error(
				`contract-call: contract id must be "{address}.{name}" (got "${intent.contract}")`,
			);
		}
		const tx = buildContractCall({
			contractAddress,
			contractName,
			functionName: intent.fn,
			functionArgs: intent.args as never,
			fee: opts.fee,
			nonce: opts.nonce,
			publicKey: opts.publicKey,
			chain: opts.chain,
			postConditions: intent.postConditions as never,
		});
		return {
			unsignedTx: tx,
			breakdown: {
				kind: "contract-call",
				contract: intent.contract,
				functionName: intent.fn,
				argsCount: intent.args.length,
			},
		};
	}
	throw new Error(
		`broadcast: intent kind "${intent.kind}" not yet supported (Sprint 4 ships transfer + contract-call only)`,
	);
}

/**
 * Submit a signed tx via the Stacks node `POST /v2/transactions` endpoint.
 * Minimal wrapper — matches the existing `actions/wallet/sendTransaction`
 * behaviour but takes a hex string directly (we already have the signed
 * bytes from the remote signer).
 */
async function submitSignedTx(
	client: PublicClient,
	signedTxHex: string,
): Promise<string> {
	const raw = signedTxHex.startsWith("0x") ? signedTxHex.slice(2) : signedTxHex;
	const bytes = new Uint8Array(Buffer.from(raw, "hex"));
	try {
		const result = await client.request("/v2/transactions", {
			method: "POST",
			body: bytes,
			headers: { "Content-Type": "application/octet-stream" },
		});
		if (typeof result === "string") return result.replace(/^"|"$/g, "");
		if (typeof result === "object" && result && "txid" in result) {
			return String((result as { txid: string }).txid);
		}
		throw new TxRejectedError(
			`Unexpected submit response: ${JSON.stringify(result)}`,
			"unknown",
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Heuristic parse of common node error strings.
		const reason = message.includes("ConflictingNonceInMempool")
			? "nonce_conflict"
			: message.includes("NotEnoughFunds")
				? "runtime_error"
				: "unknown";
		throw new TxRejectedError(`Broadcast rejected: ${message}`, reason);
	}
}
