import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import publicWaitlistRouter, { parseSignup } from "./public-waitlist.ts";

function post(body: unknown): Promise<Response> {
	const h = new Hono();
	h.route("/api/public/waitlist", publicWaitlistRouter);
	return Promise.resolve(
		h.request("/api/public/waitlist", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

const valid = {
	list: "robinhood",
	contact: "@welsh",
	role: "issuer",
	token: "WELSH",
};

describe("parseSignup", () => {
	test("moves the list's questions into answers and nulls blank optionals", () => {
		expect(parseSignup(valid)).toEqual({
			ok: {
				list: "robinhood",
				contact: "@welsh",
				answers: { role: "issuer", token: "WELSH", contract: null, note: null },
			},
		});
	});

	test("trims fields and treats whitespace-only optionals as absent", () => {
		const parsed = parseSignup({
			...valid,
			contact: " @leo ",
			token: "  LEO ",
			contract: "   ",
			note: " bridge it ",
		});
		expect(parsed).toEqual({
			ok: {
				list: "robinhood",
				contact: "@leo",
				answers: {
					role: "issuer",
					token: "LEO",
					contract: null,
					note: "bridge it",
				},
			},
		});
	});

	test("stores the token symbol in caps", () => {
		const parsed = parseSignup({ ...valid, token: "welsh" });
		expect("ok" in parsed && parsed.ok.answers.token).toBe("WELSH");
	});

	test("drops fields the list does not ask for", () => {
		const parsed = parseSignup({ ...valid, admin: true });
		expect(parsed).not.toHaveProperty("error");
		if ("ok" in parsed) expect(parsed.ok.answers).not.toHaveProperty("admin");
	});

	test("rejects a list with no answer parser, including prototype keys", () => {
		expect(parseSignup({ ...valid, list: "anything" })).toEqual({
			error: "unknown waitlist",
		});
		expect(parseSignup({ ...valid, list: "toString" })).toEqual({
			error: "unknown waitlist",
		});
	});

	test("rejects an unknown role", () => {
		expect(parseSignup({ ...valid, role: "whale" })).toHaveProperty("error");
	});

	test("requires a token and a contact", () => {
		expect(parseSignup({ ...valid, token: " " })).toHaveProperty("error");
		expect(parseSignup({ ...valid, contact: "" })).toHaveProperty("error");
	});

	test("rejects oversized fields instead of truncating them", () => {
		expect(parseSignup({ ...valid, token: "x".repeat(65) })).toHaveProperty(
			"error",
		);
		expect(parseSignup({ ...valid, note: "x".repeat(2001) })).toEqual({
			error: "note is too long",
		});
	});
});

describe("POST /api/public/waitlist", () => {
	test("answers 400 with the bad field before touching the database", async () => {
		const res = await post({ ...valid, role: "whale" });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("issuer, builder, holder");
	});

	test("rejects a non-object body", async () => {
		const res = await post(["robinhood"]);
		expect(res.status).toBe(400);
	});
});
