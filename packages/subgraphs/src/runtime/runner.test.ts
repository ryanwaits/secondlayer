/**
 * Reproduction test for sBTC subgraph processing errors.
 *
 * Demonstrates three payload mismatches in buildEventPayload():
 * 1. FT amounts: string "1000" not converted to BigInt → arithmetic throws
 * 2. Print event topic: raw "print" used instead of decoded Clarity value topic
 * 3. Contract call args: always {} → handler gets undefined for all fields
 */
import { describe, expect, test } from "bun:test";
import { decodeEventData } from "./clarity.ts";

// ── Simulate buildEventPayload internals ──────────────────────────────

// This mirrors the runner's logic so we can see what the handler actually receives.

function camelCase(str: string): string {
	return str.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
	if (obj === null || obj === undefined) return obj;
	if (typeof obj !== "object") return obj;
	if (Array.isArray(obj)) return obj.map(camelizeKeys);
	const result: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		result[camelCase(k)] = camelizeKeys(v);
	}
	return result;
}

// ── Test data ─────────────────────────────────────────────────────────

// Realistic FT mint event data as stored in DB (block ~341445)
const ftMintEventData = {
	recipient: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
	amount: "100000000", // <-- string, NOT BigInt
	asset_identifier:
		"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
};

// Realistic print event data for sBTC deposit
// In the DB: {topic: "print", value: "0x...", contract_identifier: "..."}
// The hex value decodes to a Clarity tuple containing the real topic
const printEventData = {
	topic: "print",
	// This is a simplified representation — in reality, the hex decodes to a
	// Clarity tuple like {topic: "completed-deposit", bitcoin-txid: 0x..., ...}
	// For testing, we simulate what decodeEventData returns:
	value: {
		topic: "completed-deposit",
		"bitcoin-txid": "0xabc123",
		"output-index": 0n,
		amount: 100000000n,
		"sweep-txid": "0xdef456",
		"burn-height": 800000n,
	},
	contract_identifier: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
};

// ── Bug 1: FT amounts are strings ─────────────────────────────────────

describe("Bug 1: FT amounts are strings, not BigInt", () => {
	test("decodeEventData passes through plain string amounts unchanged", () => {
		const decoded = decodeEventData(ftMintEventData) as Record<string, unknown>;
		// amount is still a string — decodeEventData only decodes "0x..." hex strings
		expect(typeof decoded.amount).toBe("string");
		expect(decoded.amount).toBe("100000000");
	});

	test("BigInt arithmetic with string amount produces garbage", () => {
		const decoded = decodeEventData(ftMintEventData) as Record<string, unknown>;
		const eventAmount = decoded.amount; // "100000000" string

		// In Bun: 0n + "100000000" → string "0100000000" (coercion, not TypeError)
		// Either way, result is wrong — not the expected 100000000n
		const balance = 0n;
		// biome-ignore lint: testing runtime behavior
		const result = balance + (eventAmount as any);
		expect(typeof result).not.toBe("bigint");
	});

	test("FIXED: amount should be BigInt after buildEventPayload", () => {
		const decoded = decodeEventData(ftMintEventData) as Record<string, unknown>;
		// The fix: convert string amounts to BigInt in buildEventPayload
		const fixedAmount = BigInt(decoded.amount as string);
		expect(typeof fixedAmount).toBe("bigint");
		expect(fixedAmount).toBe(100000000n);

		// Now arithmetic works
		const balance = 0n + fixedAmount;
		expect(balance).toBe(100000000n);
	});
});

// ── Bug 2: Print event topic is always "print" ────────────────────────

describe('Bug 2: Print event topic is always "print"', () => {
	test("current runner uses raw event topic, not decoded Clarity topic", () => {
		// Simulate what buildEventPayload does for print_event
		const decoded = printEventData; // already "decoded" for this test
		const topic = (decoded.topic as string) ?? ""; // "print" — the RAW topic
		const rawValue = decoded.value;
		const data =
			rawValue && typeof rawValue === "object"
				? (camelizeKeys(rawValue) as Record<string, unknown>)
				: rawValue;

		const payload = {
			contractId:
				decoded.contract_identifier ??
				"SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-deposit",
			topic,
			data: data ?? {},
		};

		// Handler checks: if (event.topic !== "completed-deposit") return;
		// But topic is "print" → handler ALWAYS skips → 0 deposits
		expect(payload.topic).toBe("print");
		expect(payload.topic).not.toBe("completed-deposit");
	});

	test("FIXED: topic should come from decoded Clarity value", () => {
		const decoded = printEventData;
		const rawValue = decoded.value;
		const camelized =
			rawValue && typeof rawValue === "object"
				? (camelizeKeys(rawValue) as Record<string, unknown>)
				: null;

		// The fix: extract topic from the decoded Clarity value, not raw event
		const topic =
			camelized && typeof camelized === "object" && "topic" in camelized
				? (camelized.topic as string)
				: ((decoded.topic as string) ?? "");

		// camelizeKeys only converts object KEYS, not values — topic stays as-is
		expect(topic).toBe("completed-deposit");
	});

	test("FIXED (alt): preserve raw topic string, don't camelize", () => {
		const decoded = printEventData;
		const rawValue = decoded.value as Record<string, unknown>;

		// Better fix: extract topic BEFORE camelizing, then camelize the rest
		const topic =
			rawValue && typeof rawValue === "object" && "topic" in rawValue
				? String(rawValue.topic)
				: ((decoded.topic as string) ?? "");

		// Remove topic from data before camelizing
		const { topic: _, ...rest } = rawValue;
		const data = camelizeKeys(rest) as Record<string, unknown>;

		expect(topic).toBe("completed-deposit");
		expect(data.bitcoinTxid).toBe("0xabc123");
	});
});

// ── Bug 3: Contract call args always empty ────────────────────────────

describe("Bug 3: Contract call args always empty {}", () => {
	test("args is hardcoded to {} — handler gets undefined for all fields", () => {
		// What buildEventPayload returns for contract_call (no event):
		const payload = {
			contractId: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal",
			functionName: "initiate-withdrawal-request",
			caller: "SP2C2YFP12AJZB1MAYFHQK96CVK4AWZ26PFYG40MF",
			args: {} as Record<string, unknown>,
			result: null,
		};

		// Handler does: const args = event.args as Record<string, unknown>
		const args = payload.args;
		expect(args.amount).toBeUndefined(); // → 0n fallback in handler
		expect(args.maxFee).toBeUndefined();

		// event.result is null
		// biome-ignore lint/suspicious/noExplicitAny: test mock typing for stubs/spies; constraining types adds noise without safety benefit
		expect((payload.result as any)?.ok).toBeUndefined(); // → 0n fallback

		// All withdrawals get request_id = 0n, amount = 0n, max_fee = 0n
		// This is why withdrawal data is wrong
	});
});
