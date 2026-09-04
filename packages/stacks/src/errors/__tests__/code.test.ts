import { describe, expect, test } from "bun:test";
import { BaseError } from "../base.ts";
import { HttpRequestError } from "../http.ts";
import { MalformedResponseError, ReadContractError } from "../response.ts";
import { TimeoutError } from "../transport.ts";

describe("error codes", () => {
	test("every subclass carries a stable screaming-snake code derived from its name field", () => {
		expect(new HttpRequestError(500).code).toBe("HTTP_REQUEST_ERROR");
		expect(
			new TimeoutError({ method: "GET", url: "u", timeout: 1, attempt: 0 })
				.code,
		).toBe("TIMEOUT_ERROR");
		expect(new MalformedResponseError("x").code).toBe(
			"MALFORMED_RESPONSE_ERROR",
		);
		expect(new ReadContractError("x").code).toBe("READ_CONTRACT_ERROR");
		expect(new BaseError("x").code).toBe("STACKS_ERROR");
	});

	test("a mangled class name does not change the code because it derives from name, not the constructor", () => {
		const Mangled = class A extends BaseError {
			override name = "HttpRequestError";
		};
		expect(new Mangled("x").code).toBe("HTTP_REQUEST_ERROR");
	});

	test("an explicit code wins over the derived one", () => {
		expect(new BaseError("x", { code: "CUSTOM" }).code).toBe("CUSTOM");
	});

	test("toJSON includes the code so serialized errors stay branchable", () => {
		expect(new HttpRequestError(404).toJSON().code).toBe("HTTP_REQUEST_ERROR");
	});
});
