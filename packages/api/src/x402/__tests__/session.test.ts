import { describe, expect, test } from "bun:test";
import { mintSessionVoucher, verifySessionVoucher } from "../session.ts";

const SECRET = "test-secret";
const voucher = {
	v: 1 as const,
	id: "nonce-abc",
	surface: "streams",
	payer: "SP1TEST",
	exp: Date.now() + 60_000,
};

describe("x402 session vouchers", () => {
	test("mint → verify roundtrip", () => {
		const token = mintSessionVoucher(voucher, SECRET);
		expect(verifySessionVoucher(token, SECRET)).toEqual(voucher);
	});

	test("tampered payload rejected", () => {
		const token = mintSessionVoucher(voucher, SECRET);
		const [payload, sig] = token.split(".");
		const forged = Buffer.from(
			JSON.stringify({ ...voucher, payer: "SP2EVIL" }),
		).toString("base64url");
		expect(verifySessionVoucher(`${forged}.${sig}`, SECRET)).toBeNull();
		expect(verifySessionVoucher(`${payload}.AAAA`, SECRET)).toBeNull();
	});

	test("wrong secret rejected", () => {
		const token = mintSessionVoucher(voucher, SECRET);
		expect(verifySessionVoucher(token, "other-secret")).toBeNull();
	});

	test("expired voucher rejected", () => {
		const token = mintSessionVoucher(
			{ ...voucher, exp: Date.now() - 1 },
			SECRET,
		);
		expect(verifySessionVoucher(token, SECRET)).toBeNull();
	});

	test("garbage rejected", () => {
		expect(verifySessionVoucher("not-a-voucher", SECRET)).toBeNull();
		expect(verifySessionVoucher("", SECRET)).toBeNull();
	});
});
