import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { errorHandler, isUniqueViolation } from "./error.ts";

function appThrowing(error: unknown) {
	const app = new Hono();
	app.onError(errorHandler);
	app.post("/", () => {
		throw error;
	});
	return app;
}

describe("unique violations", () => {
	test("a Postgres unique_violation answers 409, not 500", async () => {
		const duplicate = Object.assign(new Error("duplicate key value"), {
			code: "23505",
			constraint_name: "webhooks_account_id_name_key",
		});
		const res = await appThrowing(duplicate).request("/", { method: "POST" });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: "A resource with that name already exists",
			code: "CONFLICT",
		});
	});

	test("other database errors stay 500", async () => {
		const res = await appThrowing(
			Object.assign(new Error("syntax"), { code: "42601" }),
		).request("/", { method: "POST" });
		expect(res.status).toBe(500);
	});

	test("isUniqueViolation only matches 23505", () => {
		expect(isUniqueViolation({ code: "23505" })).toBe(true);
		expect(isUniqueViolation({ code: "23503" })).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
		expect(isUniqueViolation("23505")).toBe(false);
	});
});
