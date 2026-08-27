import { describe, expect, test } from "bun:test";
import { createExtendedApp } from "./app.ts";
import {
	type DecodedEventRow,
	type ExtendedTxEvent,
	projectDecodedEventToHiro,
} from "./events.ts";
import type { ExtendedTx } from "./transactions.ts";

const TX: ExtendedTx = {
	tx_id: "0xabc",
	tx_index: 0,
	tx_status: "success",
	tx_type: "contract_call",
	sender_address: "SP1SENDER",
	block_height: 100,
};

const STX_ROW: DecodedEventRow = {
	tx_id: "0xabc",
	event_index: 0,
	event_type: "stx_transfer",
	contract_id: null,
	sender: "SP1SENDER",
	recipient: "SP1RECV",
	amount: "1000",
	asset_identifier: null,
	value: null,
	memo: null,
	payload: null,
};

const FT_MINT_ROW: DecodedEventRow = {
	tx_id: "0xabc",
	event_index: 1,
	event_type: "ft_mint",
	contract_id: "SP1.token",
	sender: null,
	recipient: "SP1RECV",
	amount: "50",
	asset_identifier: "SP1.token::TOKEN",
	value: null,
	memo: null,
	payload: null,
};

const UNKNOWN_ROW: DecodedEventRow = {
	tx_id: "0xabc",
	event_index: 2,
	event_type: "something_else",
	contract_id: null,
	sender: null,
	recipient: null,
	amount: null,
	asset_identifier: null,
	value: null,
	memo: null,
	payload: null,
};

describe("projectDecodedEventToHiro", () => {
	test("stx_transfer → stx_asset + asset_event_type transfer", () => {
		const ev = projectDecodedEventToHiro(STX_ROW);
		expect(ev).toEqual({
			event_index: 0,
			event_type: "stx_asset",
			tx_id: "0xabc",
			asset: {
				asset_event_type: "transfer",
				sender: "SP1SENDER",
				recipient: "SP1RECV",
				amount: "1000",
			},
		});
	});

	test("ft_mint → fungible_token_asset + mint", () => {
		const ev = projectDecodedEventToHiro(FT_MINT_ROW);
		expect(ev?.event_type).toBe("fungible_token_asset");
		expect(ev?.asset?.asset_event_type).toBe("mint");
		expect(ev?.asset?.asset_id).toBe("SP1.token::TOKEN");
		expect(ev?.asset?.amount).toBe("50");
	});

	test("stx_lock → stx_asset without asset_event_type", () => {
		const ev = projectDecodedEventToHiro({
			...STX_ROW,
			event_type: "stx_lock",
			recipient: null,
		});
		expect(ev?.event_type).toBe("stx_asset");
		expect(ev?.asset?.asset_event_type).toBeUndefined();
		expect(ev?.asset?.sender).toBe("SP1SENDER");
		expect(ev?.asset?.amount).toBe("1000");
	});

	test("unknown type → null", () => {
		expect(projectDecodedEventToHiro(UNKNOWN_ROW)).toBeNull();
	});

	test("print → smart_contract_log from payload topic/value", () => {
		const ev = projectDecodedEventToHiro({
			tx_id: "0xabc",
			event_index: 3,
			event_type: "print",
			contract_id: "SP1.contract",
			sender: null,
			recipient: null,
			amount: null,
			asset_identifier: null,
			value: null,
			memo: null,
			payload: { topic: "print", value: { n: "1" }, raw_value: "0x0a" },
		});
		expect(ev).toEqual({
			event_index: 3,
			event_type: "smart_contract_log",
			tx_id: "0xabc",
			contract_log: {
				contract_id: "SP1.contract",
				topic: "print",
				value: { n: "1" },
			},
		});
	});
});

describe("extended tx events route", () => {
	test("returns JSON array ordered by event_index; drops unknown", async () => {
		const mapped: ExtendedTxEvent[] = [
			projectDecodedEventToHiro(STX_ROW) as ExtendedTxEvent,
			projectDecodedEventToHiro(FT_MINT_ROW) as ExtendedTxEvent,
		];
		const app = createExtendedApp({
			getTransaction: async (id) => {
				expect(id).toBe("0xabc");
				return TX;
			},
			listTxEvents: async () => mapped,
		});
		const res = await app.request("/extended/v1/tx/0xabc/events");
		expect(res.status).toBe(200);
		const body = (await res.json()) as ExtendedTxEvent[];
		expect(Array.isArray(body)).toBe(true);
		expect(body.map((e) => e.event_index)).toEqual([0, 1]);
		expect(body[0]?.event_type).toBe("stx_asset");
		expect(body[0]?.asset?.asset_event_type).toBe("transfer");
		expect(body[1]?.event_type).toBe("fungible_token_asset");
		expect(body[1]?.asset?.asset_event_type).toBe("mint");
		expect("next_cursor" in (body as unknown as object)).toBe(false);
	});

	test("empty events for existing tx → [] 200", async () => {
		const app = createExtendedApp({
			getTransaction: async () => TX,
			listTxEvents: async () => [],
		});
		const res = await app.request("/extended/v1/tx/0xabc/events");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	test("missing tx → 404 Hiro-shaped no code", async () => {
		const app = createExtendedApp({
			getTransaction: async () => null,
			listTxEvents: async () => {
				throw new Error("listTxEvents must not run when tx missing");
			},
		});
		const res = await app.request("/extended/v1/tx/0xmissing/events");
		expect(res.status).toBe(404);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ error: "Not found" });
		expect("code" in body).toBe(false);
	});
});
