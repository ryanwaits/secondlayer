import { describe, expect, test } from "bun:test";
import { PUBLIC_API_URL } from "@/lib/public-api";
import {
	LASTING_KEY_NEXT,
	codeStepHref,
	docsKeyMintRequest,
	lastsFor,
	mintFailure,
} from "./docs-key-mint";

describe("docsKeyMintRequest", () => {
	test("signed in, the web server mints from the session cookie", () => {
		const { url, init } = docsKeyMintRequest(true);
		expect(url).toBe("/api/keys/docs");
		expect(init.credentials).toBe("same-origin");
		expect(init.method).toBe("POST");
	});

	test("signed out, the browser asks the API directly without cookies", () => {
		const { url, init } = docsKeyMintRequest(false);
		expect(url).toBe(`${PUBLIC_API_URL}/api/public/docs-key`);
		expect(init.credentials).toBe("omit");
		expect(init.method).toBe("POST");
		// The API's write guard takes JSON bodies only.
		expect(init.headers).toEqual({ "Content-Type": "application/json" });
	});
});

describe("mintFailure", () => {
	test("signed out, a 429 says the daily limit and offers a lasting key", () => {
		expect(mintFailure(429, false)).toEqual({
			kind: "daily",
			text: "One docs key a day without an account",
		});
	});

	test("signed in, a 429 flashes as before", () => {
		expect(mintFailure(429, true)).toEqual({
			kind: "flash",
			text: "Limit reached",
		});
	});

	test("any other failure asks to try again", () => {
		expect(mintFailure(502, false)).toEqual({
			kind: "flash",
			text: "Try again",
		});
		expect(mintFailure(500, true).text).toBe("Try again");
	});
});

describe("codeStepHref", () => {
	test("opens sign-in on the code step and returns to New key", () => {
		const href = codeStepHref("ada@example.com");
		const url = new URL(href, "https://www.secondlayer.tools");
		expect(url.pathname).toBe("/signin");
		expect(url.searchParams.get("email")).toBe("ada@example.com");
		expect(url.searchParams.get("next")).toBe(LASTING_KEY_NEXT);
		expect(LASTING_KEY_NEXT).toBe("/account/keys?new=1");
	});

	test("an address with a plus survives the round trip", () => {
		const url = new URL(codeStepHref("a+docs@example.com"), "https://x.test");
		expect(url.searchParams.get("email")).toBe("a+docs@example.com");
	});
});

describe("lastsFor", () => {
	const now = Date.parse("2026-11-07T12:00:00Z");
	const at = (ms: number) => new Date(now + ms).toISOString();

	test("hours, rounded down, then minutes in the last hour", () => {
		expect(lastsFor(at(23 * 3_600_000 + 59 * 60_000), now)).toBe("23 hours");
		expect(lastsFor(at(3_600_000 + 60_000), now)).toBe("1 hour");
		expect(lastsFor(at(40 * 60_000), now)).toBe("40 minutes");
		expect(lastsFor(at(10_000), now)).toBe("1 minute");
	});
});
