import { describe, expect, test } from "bun:test";
import { buildModel, resolveProvider } from "./providers.ts";

describe("resolveProvider", () => {
	test("empty env gives rules", () => {
		expect(resolveProvider({})).toEqual({ name: "rules", modelId: "rules" });
	});
	test("gateway key alone gives jev", () => {
		expect(resolveProvider({ AI_GATEWAY_API_KEY: "k" })).toEqual({
			name: "jev",
			modelId: "typesafe-ai/jev",
		});
	});
	test("empty CLASSIFIER_MODEL falls back to the provider default", () => {
		expect(
			resolveProvider({ AI_GATEWAY_API_KEY: "k", CLASSIFIER_MODEL: "" }),
		).toEqual({ name: "jev", modelId: "typesafe-ai/jev" });
	});
	test("whitespace CLASSIFIER_MODEL falls back to the provider default", () => {
		expect(
			resolveProvider({
				CLASSIFIER: "kev",
				KEV_URL: "http://x:8009",
				CLASSIFIER_MODEL: "  ",
			}),
		).toEqual({ name: "kev", modelId: "kev-latest" });
	});
	test("kev without KEV_URL falls back to rules", () => {
		expect(resolveProvider({ CLASSIFIER: "kev" }).name).toBe("rules");
	});
	test("kev with KEV_URL resolves", () => {
		expect(
			resolveProvider({ CLASSIFIER: "kev", KEV_URL: "http://x:8009" }),
		).toEqual({ name: "kev", modelId: "kev-latest" });
	});
	test("clef needs both vars; CLASSIFIER_MODEL pins the model", () => {
		expect(
			resolveProvider({ CLASSIFIER: "clef", CLOUDFLARE_ACCOUNT_ID: "a" }).name,
		).toBe("rules");
		expect(
			resolveProvider({
				CLASSIFIER: "clef",
				CLOUDFLARE_ACCOUNT_ID: "a",
				CLOUDFLARE_API_TOKEN: "t",
				CLASSIFIER_MODEL: "clef-flash",
			}),
		).toEqual({ name: "clef", modelId: "clef-flash" });
	});
	test("unknown CLASSIFIER gives rules", () => {
		expect(
			resolveProvider({ CLASSIFIER: "nope", AI_GATEWAY_API_KEY: "k" }).name,
		).toBe("rules");
	});
	test("CLASSIFIER=jev without key gives rules", () => {
		expect(resolveProvider({ CLASSIFIER: "jev" }).name).toBe("rules");
	});
});

describe("buildModel", () => {
	test("jev returns the model id string", () => {
		expect(buildModel("jev", "typesafe-ai/jev", {})).toBe("typesafe-ai/jev");
	});

	test("kev url has no double slash", async () => {
		let url = "";
		const fetchImpl = (async (u: string) => {
			url = u;
			return new Response(JSON.stringify({ answers: {} }));
		}) as unknown as typeof fetch;
		const m = buildModel(
			"kev",
			"kev-latest",
			{ KEV_URL: "http://kev:8009/" },
			fetchImpl,
		);
		if (typeof m === "string") throw new Error("expected model object");
		await m.doDecide({ state: [{ type: "text", text: "x" }], questions: {} });
		expect(url).toBe("http://kev:8009/v1/systemone");
	});

	test("clef url and body model", async () => {
		let url = "";
		let model = "";
		const fetchImpl = (async (u: string, init: RequestInit) => {
			url = u;
			model = JSON.parse(String(init.body)).model;
			return new Response(JSON.stringify({ result: { answers: {} } }));
		}) as unknown as typeof fetch;
		const m = buildModel(
			"clef",
			"clef-flash",
			{ CLOUDFLARE_ACCOUNT_ID: "acct", CLOUDFLARE_API_TOKEN: "t" },
			fetchImpl,
		);
		if (typeof m === "string") throw new Error("expected model object");
		await m.doDecide({ state: [{ type: "text", text: "x" }], questions: {} });
		expect(url).toBe(
			"https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash",
		);
		expect(model).toBe("clef-flash");
	});
});
