import { describe, expect, test } from "bun:test";
import {
	SESSION_UNKNOWN,
	accountOf,
	sessionFromMe,
	sessionReducer,
} from "./auth-session";
import type { Account } from "./types";

const account = { id: "a1", email: "a@b.co" } as Account;

describe("sessionFromMe", () => {
	test("a 200 with an account is signed in", () => {
		expect(sessionFromMe(200, { account })).toEqual({
			kind: "signedIn",
			account,
		});
	});

	test("a 401, or a 200 with a null account, is signed out", () => {
		expect(sessionFromMe(401, { error: "unauthorized" })).toEqual({
			kind: "signedOut",
		});
		expect(sessionFromMe(200, { account: null })).toEqual({
			kind: "signedOut",
		});
	});

	test("a server error or an unreadable body says nothing about the session", () => {
		expect(sessionFromMe(500, { error: "boom" })).toEqual({
			kind: "unreachable",
		});
		expect(sessionFromMe(502, null)).toEqual({ kind: "unreachable" });
		expect(sessionFromMe(200, null)).toEqual({ kind: "unreachable" });
		expect(sessionFromMe(200, {})).toEqual({ kind: "unreachable" });
	});
});

describe("sessionReducer", () => {
	test("a network error before anything is known is unreachable, not signed out", () => {
		const next = sessionReducer(SESSION_UNKNOWN, { type: "unreachable" });
		expect(next).toEqual({ kind: "unreachable" });
		expect(accountOf(next)).toBeNull();
	});

	test("a failed re-check keeps a signed-in session signed in", () => {
		const signedIn = sessionReducer(SESSION_UNKNOWN, {
			type: "signedIn",
			account,
		});
		expect(sessionReducer(signedIn, { type: "unreachable" })).toBe(signedIn);
		expect(
			sessionReducer(signedIn, { type: "answered", status: 503, body: null }),
		).toBe(signedIn);
	});

	test("a retry after unreachable can land on any answer", () => {
		const unreachable = sessionReducer(SESSION_UNKNOWN, {
			type: "unreachable",
		});
		expect(
			sessionReducer(unreachable, {
				type: "answered",
				status: 200,
				body: { account },
			}),
		).toEqual({ kind: "signedIn", account });
		expect(
			sessionReducer(unreachable, {
				type: "answered",
				status: 401,
				body: null,
			}),
		).toEqual({ kind: "signedOut" });
	});

	test("an explicit signed-out answer signs out a signed-in session", () => {
		const signedIn = sessionReducer(SESSION_UNKNOWN, {
			type: "signedIn",
			account,
		});
		expect(
			sessionReducer(signedIn, { type: "answered", status: 401, body: null }),
		).toEqual({ kind: "signedOut" });
	});
});
