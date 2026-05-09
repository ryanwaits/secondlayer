import { describe, expect, test } from "bun:test";
import {
	bnsName,
	poxStack,
	sbtcDeposit,
	sbtcWithdrawal,
	sip009Transfer,
	sip010Transfer,
	transferTo,
} from "../index.ts";

const TARGET = { subgraph: "my-watcher", table: "transfers" };

describe("transferTo", () => {
	test("recipient only", () => {
		expect(transferTo(TARGET, "SP1ABC")).toEqual({
			subgraphName: "my-watcher",
			tableName: "transfers",
			filter: { recipient: "SP1ABC" },
		});
	});

	test("recipient + asset", () => {
		expect(
			transferTo(TARGET, "SP1ABC", { asset: "SP1...usdc::usdc-token" }),
		).toEqual({
			subgraphName: "my-watcher",
			tableName: "transfers",
			filter: {
				recipient: "SP1ABC",
				asset_identifier: "SP1...usdc::usdc-token",
			},
		});
	});
});

describe("sip010Transfer", () => {
	test("no asset → matches every transfer in the bound table", () => {
		expect(sip010Transfer(TARGET).filter).toEqual({});
	});

	test("asset filter", () => {
		expect(sip010Transfer(TARGET, "SP1...usdc::usdc-token").filter).toEqual({
			asset_identifier: "SP1...usdc::usdc-token",
		});
	});

	test("asset + recipient", () => {
		expect(
			sip010Transfer(TARGET, "SP1...usdc::usdc-token", {
				recipient: "SP1RECV",
			}).filter,
		).toEqual({
			asset_identifier: "SP1...usdc::usdc-token",
			recipient: "SP1RECV",
		});
	});
});

describe("sip009Transfer", () => {
	test("token id coerces to string", () => {
		expect(
			sip009Transfer(TARGET, "SP1...nft::token-name", { tokenId: 42 }).filter,
		).toEqual({
			asset_identifier: "SP1...nft::token-name",
			token_id: "42",
		});
	});
});

describe("bnsName", () => {
	test("no action → fires on every name event", () => {
		expect(bnsName(TARGET).filter).toEqual({});
	});

	test("action filter", () => {
		expect(bnsName(TARGET, "new-name").filter).toEqual({ topic: "new-name" });
	});

	test("namespace + owner", () => {
		expect(
			bnsName(TARGET, "transfer-name", { namespace: "btc", owner: "SP1OWN" })
				.filter,
		).toEqual({
			topic: "transfer-name",
			namespace: "btc",
			owner: "SP1OWN",
		});
	});
});

describe("poxStack", () => {
	test("function filter", () => {
		expect(poxStack(TARGET, "stack-stx").filter).toEqual({
			function_name: "stack-stx",
		});
	});

	test("stacker filter without function", () => {
		expect(poxStack(TARGET, undefined, { stacker: "SP1STK" }).filter).toEqual({
			stacker: "SP1STK",
		});
	});
});

describe("sbtcDeposit", () => {
	test("topic locked to completed-deposit", () => {
		expect(sbtcDeposit(TARGET).filter).toEqual({ topic: "completed-deposit" });
	});

	test("with bitcoin txid", () => {
		expect(sbtcDeposit(TARGET, { bitcoinTxid: "0xa1b2" }).filter).toEqual({
			topic: "completed-deposit",
			bitcoin_txid: "0xa1b2",
		});
	});
});

describe("sbtcWithdrawal", () => {
	test("no phase → matches all three withdrawal topics", () => {
		expect(sbtcWithdrawal(TARGET).filter).toEqual({
			topic: {
				in: ["withdrawal-create", "withdrawal-accept", "withdrawal-reject"],
			},
		});
	});

	test("phase narrows to one topic", () => {
		expect(sbtcWithdrawal(TARGET, { phase: "accept" }).filter).toEqual({
			topic: { eq: "withdrawal-accept" },
		});
	});

	test("requestId scalar", () => {
		expect(
			sbtcWithdrawal(TARGET, { phase: "create", requestId: 42 }).filter,
		).toEqual({
			topic: { eq: "withdrawal-create" },
			request_id: 42,
		});
	});
});
