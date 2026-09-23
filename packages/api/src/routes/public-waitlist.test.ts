import { describe, expect, test } from "bun:test";
import { getDb } from "@secondlayer/shared/db";
import { Hono } from "hono";
import publicWaitlistRouter, {
	parseSignup,
	summarizeDemand,
} from "./public-waitlist.ts";

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

	test("removes spaces inside the token symbol", () => {
		const parsed = parseSignup({ ...valid, token: "Stacks  memecoins" });
		expect("ok" in parsed && parsed.ok.answers.token).toBe("STACKSMEMECOINS");
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

describe("summarizeDemand", () => {
	const row = (symbol: string, requests: number, team = false) => ({
		symbol,
		requests,
		team,
	});

	test("shows a token only once two different people asked for it", () => {
		const out = summarizeDemand([row("WELSH", 2), row("LEO", 1)]);
		expect(out.tokens.map((t) => t.symbol)).toEqual(["WELSH"]);
		expect(out.others).toBe(1);
	});

	test("never prints free text that isn't ticker-shaped, however popular", () => {
		const out = summarizeDemand([
			row("BUY NOW AT SCAM.XYZ", 9),
			row("<SCRIPT>", 9),
			row("PEPE", 3),
		]);
		expect(out.tokens.map((t) => t.symbol)).toEqual(["PEPE"]);
		expect(out.others).toBe(2);
	});

	test("shows tickers up to sixteen characters", () => {
		const out = summarizeDemand([
			row("STACKSMEMECOINS", 2),
			row("X".repeat(17), 2),
		]);
		expect(out.tokens.map((t) => t.symbol)).toEqual(["STACKSMEMECOINS"]);
		expect(out.others).toBe(1);
	});

	test("ranks by requests, then symbol, and caps the board at eight", () => {
		const rows = Array.from({ length: 10 }, (_, i) =>
			row(`T${String(i).padStart(2, "0")}`, 10 - (i % 3)),
		);
		const out = summarizeDemand(rows);
		expect(out.tokens).toHaveLength(8);
		expect(out.others).toBe(2);
		expect(out.tokens[0]).toEqual(row("T00", 10));
		expect(out.tokens[1]).toEqual(row("T03", 10));
	});

	test("carries the team flag through without any contact", () => {
		const out = summarizeDemand([row("DIKO", 4, true)]);
		expect(out.tokens[0]).toEqual({ symbol: "DIKO", requests: 4, team: true });
	});
});

describe("GET /api/public/waitlist/:list/demand", () => {
	function get(list: string): Promise<Response> {
		const h = new Hono();
		h.route("/api/public/waitlist", publicWaitlistRouter);
		return Promise.resolve(h.request(`/api/public/waitlist/${list}/demand`));
	}

	test("404s a list that doesn't exist, before touching the database", async () => {
		expect((await get("anything")).status).toBe(404);
		expect((await get("toString")).status).toBe(404);
	});

	const HAS_DB = !!process.env.DATABASE_URL;
	test.skipIf(!HAS_DB)(
		"aggregates signups per token and never returns a contact",
		async () => {
			const db = getDb();
			const contacts = ["@demand-a", "@DEMAND-A", "@demand-b", "@demand-c"];
			try {
				await db
					.insertInto("waitlist_signups")
					.values([
						{
							list: "robinhood",
							contact: contacts[0],
							answers: { role: "holder", token: "ZZTEST" },
						},
						{
							list: "robinhood",
							contact: contacts[2],
							answers: { role: "issuer", token: "ZZTEST" },
						},
						{
							list: "robinhood",
							contact: contacts[3],
							answers: { role: "holder", token: "ZZSOLO" },
						},
					])
					.execute();
				const res = await get("robinhood");
				expect(res.status).toBe(200);
				const text = await res.text();
				for (const c of contacts) {
					expect(text.toLowerCase()).not.toContain(c.toLowerCase());
				}
				const body = JSON.parse(text) as {
					tokens: { symbol: string; requests: number; team: boolean }[];
				};
				expect(body.tokens.find((t) => t.symbol === "ZZTEST")).toEqual({
					symbol: "ZZTEST",
					requests: 2,
					team: true,
				});
				expect(body.tokens.some((t) => t.symbol === "ZZSOLO")).toBe(false);
			} finally {
				await db
					.deleteFrom("waitlist_signups")
					.where("contact", "in", contacts)
					.execute();
			}
		},
	);
});
